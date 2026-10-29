// Map tile cache served on the tile:// scheme: tile://<source>/<z>/<x>/<y>
// Tiles seen while browsing are kept on disk. Area download is capped to respect tile server usage policies.
const { net } = require('electron');
const fs = require('fs');
const path = require('path');

const SOURCES = {
  // The openstreetmap.org tile servers do not permit offline-caching apps, so they are not offered here.
  topo: {
    name: 'OpenTopoMap (contours)',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors, SRTM | style &copy; OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
  },
};

const UA = 'Holdfast/0.2 (personal offline household planner)';
const AREA_TILE_CAP = 3000;

class Tiles {
  constructor(dir, getSettings, emit) {
    this.dir = dir;
    this.getSettings = getSettings;
    this.emit = emit;
    this.cancelled = false;
    this.busy = false;
    fs.mkdirSync(dir, { recursive: true });
  }

  sources() {
    const s = { ...SOURCES };
    const custom = (this.getSettings().customTileUrl || '').trim();
    if (custom) s.custom = { name: 'Custom', url: custom, attribution: this.getSettings().customTileAttribution || '', maxZoom: 19 };
    return s;
  }

  tilePath(src, z, x, y) {
    return path.join(this.dir, src, String(z), String(x), `${y}.png`);
  }

  async handle(request) {
    const u = new URL(request.url);
    const src = u.host;
    const [z, x, y] = u.pathname.split('/').filter(Boolean).map((n) => parseInt(n, 10));
    if (![z, x, y].every(Number.isFinite)) return new Response('bad tile', { status: 400 });
    const p = this.tilePath(src, z, x, y);
    if (fs.existsSync(p)) return new Response(fs.readFileSync(p), { headers: { 'content-type': 'image/png' } });
    if (this.getSettings().offlineMode) return new Response('', { status: 404 });
    try {
      const buf = await this.fetchTile(src, z, x, y);
      return new Response(buf, { headers: { 'content-type': 'image/png' } });
    } catch (e) {
      return new Response('', { status: 404 });
    }
  }

  async fetchTile(src, z, x, y) {
    const s = this.sources()[src];
    if (!s) throw new Error('unknown source');
    const url = s.url.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', 'a');
    const res = await net.fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const p = this.tilePath(src, z, x, y);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
    return buf;
  }

  static tilesFor(bounds, minZ, maxZ) {
    const out = [];
    for (let z = minZ; z <= maxZ; z++) {
      const a = lonLatToTile(bounds.west, bounds.north, z);
      const b = lonLatToTile(bounds.east, bounds.south, z);
      for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++)
        for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) out.push([z, x, y]);
    }
    return out;
  }

  estimate(bounds, minZ, maxZ) {
    return { count: Tiles.tilesFor(bounds, minZ, maxZ).length, cap: AREA_TILE_CAP };
  }

  cancel() {
    this.cancelled = true;
  }

  async downloadArea(src, bounds, minZ, maxZ) {
    if (this.busy) throw new Error('A download is already running');
    const list = Tiles.tilesFor(bounds, minZ, maxZ);
    if (list.length > AREA_TILE_CAP) throw new Error(`Area too large: ${list.length} tiles (limit ${AREA_TILE_CAP}). Zoom in or lower the max zoom.`);
    this.busy = true;
    this.cancelled = false;
    let done = 0, fetched = 0, failed = 0;
    try {
      // Two at a time with a short pause, to stay polite to the tile server.
      const worker = async () => {
        while (list.length && !this.cancelled) {
          const [z, x, y] = list.shift();
          if (!fs.existsSync(this.tilePath(src, z, x, y))) {
            try {
              await this.fetchTile(src, z, x, y);
              fetched++;
            } catch (e) {
              failed++;
            }
            await new Promise((r) => setTimeout(r, 120));
          }
          done++;
          if (done % 10 === 0) this.emit('tiles:progress', { done, fetched, failed, remaining: list.length });
        }
      };
      await Promise.all([worker(), worker()]);
    } finally {
      this.busy = false;
    }
    const result = { done, fetched, failed, cancelled: this.cancelled };
    this.emit('tiles:progress', { ...result, remaining: 0, finished: true });
    return result;
  }

  stats() {
    let files = 0, bytes = 0;
    const walk = (d) => {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else {
          files++;
          bytes += fs.statSync(p).size;
        }
      }
    };
    walk(this.dir);
    return { files, bytes };
  }

  clear(src) {
    fs.rmSync(src ? path.join(this.dir, src) : this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
  }
}

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

module.exports = { Tiles };
