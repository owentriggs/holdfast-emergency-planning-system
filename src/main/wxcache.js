// Weather map data, kept under <userData>/weather (not part of USB backups):
//   radar/<time>-<id>/<z>/<x>/<y>.png  rain radar tiles from RainViewer, served on wx://radar/<time>-<id>/<z>/<x>/<y>
//   forecasts/<stamp>.json             forecast grids from Open-Meteo, listed in forecasts/index.json
//   floods/<areaId>.json               Environment Agency flood area outlines
//   storms.json                        active tropical storms from the US National Hurricane Center
// Old downloads are pruned: radar after two days, forecasts and storms after the days set in Settings, flood
// outlines when not used for two months.
const { net } = require('electron');
const fs = require('fs');
const path = require('path');

const UA = 'Holdfast/0.2 (personal offline household planner)';
const RADAR_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_HOST = 'https://tilecache.rainviewer.com';
const RADAR_KEEP_HOURS = 48;
const RADAR_MAX_ZOOM = 7; // RainViewer's free tiles stop at zoom 7
const RADAR_TILE_CAP = 1500;
const GRID_SIDE = 12; // forecast points per side of the grid
const GRID_VARS = ['precipitation', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'temperature_2m', 'pressure_msl'];
const MAX_FORECASTS = 10;
const FLOOD_KEEP_DAYS = 60;
const FRAME_RE = /^(\d{9,11})-([0-9a-f]{6,32})$/;

class WxCache {
  constructor(dir, getSettings, emit) {
    this.dir = dir;
    this.getSettings = getSettings;
    this.emit = emit;
    this.busy = false;
    this.cancelled = false;
    this.mkdirs();
  }

  mkdirs() {
    for (const d of ['radar', 'forecasts', 'floods']) fs.mkdirSync(path.join(this.dir, d), { recursive: true });
  }

  offline() {
    return !!this.getSettings().offlineMode;
  }

  keepDays() {
    const d = Number(this.getSettings().weatherKeepDays);
    return d > 0 ? d : 14;
  }

  async getJson(url) {
    const res = await net.fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res.json();
  }

  // Radar

  savedFrames() {
    return fs.readdirSync(path.join(this.dir, 'radar')).map((d) => d.match(FRAME_RE)).filter(Boolean)
      .map((m) => ({ time: Number(m[1]), id: m[2], key: m[0], saved: true }));
  }

  // Frames the server has now (about the last two hours, every 10 minutes) plus any saved earlier.
  // Offline, only saved frames are listed.
  async radarFrames() {
    const byKey = new Map(this.savedFrames().map((f) => [f.key, f]));
    if (!this.offline()) {
      const j = await this.getJson(RADAR_INDEX);
      for (const f of [...(j.radar?.past || []), ...(j.radar?.nowcast || [])]) {
        const id = String(f.path).split('/').pop();
        const key = `${f.time}-${id}`;
        if (FRAME_RE.test(key) && !byKey.has(key)) byKey.set(key, { time: f.time, id, key, saved: false });
      }
    }
    return [...byKey.values()].sort((a, b) => a.time - b.time);
  }

  radarPath(key, z, x, y) {
    return path.join(this.dir, 'radar', key, String(z), String(x), `${y}.png`);
  }

  async fetchRadarTile(key, z, x, y) {
    const id = key.match(FRAME_RE)[2];
    const res = await net.fetch(`${RADAR_HOST}/v2/radar/${id}/256/${z}/${x}/${y}/2/1_1.png`, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const p = this.radarPath(key, z, x, y);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
    return buf;
  }

  // wx://radar/<time>-<id>/<z>/<x>/<y>. Tiles seen are kept, like map tiles, until the frame is pruned.
  async handle(request) {
    const u = new URL(request.url);
    const [key, ...rest] = u.pathname.split('/').filter(Boolean);
    const [z, x, y] = rest.map((n) => parseInt(n, 10));
    if (u.host !== 'radar' || !FRAME_RE.test(key || '') || ![z, x, y].every(Number.isFinite) || z > RADAR_MAX_ZOOM) return new Response('', { status: 404 });
    const p = this.radarPath(key, z, x, y);
    if (fs.existsSync(p)) return new Response(fs.readFileSync(p), { headers: { 'content-type': 'image/png' } });
    if (this.offline()) return new Response('', { status: 404 });
    try {
      return new Response(await this.fetchRadarTile(key, z, x, y), { headers: { 'content-type': 'image/png' } });
    } catch (e) {
      return new Response('', { status: 404 });
    }
  }

  // Saves every current radar frame for the area, zoom 5 to 7, so the loop plays offline.
  async downloadRadar(bounds) {
    if (this.busy) throw new Error('A download is already running');
    if (this.offline()) throw new Error('Offline mode is on');
    const frames = (await this.radarFrames()).filter((f) => Date.now() / 1000 - f.time < RADAR_KEEP_HOURS * 3600);
    const tiles = tilesFor(bounds, 5, RADAR_MAX_ZOOM);
    const list = frames.flatMap((f) => tiles.map((t) => [f.key, ...t]));
    if (list.length > RADAR_TILE_CAP) throw new Error(`Area too large: ${list.length} radar tiles (limit ${RADAR_TILE_CAP}). Zoom in.`);
    this.busy = true;
    this.cancelled = false;
    let done = 0, failed = 0;
    const total = list.length;
    try {
      const worker = async () => {
        while (list.length && !this.cancelled) {
          const [key, z, x, y] = list.shift();
          if (!fs.existsSync(this.radarPath(key, z, x, y))) {
            try { await this.fetchRadarTile(key, z, x, y); } catch (e) { failed++; }
          }
          done++;
          if (done % 10 === 0) this.emit('wx:progress', { what: 'radar', done, total });
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    } finally {
      this.busy = false;
      this.emit('wx:progress', { what: 'radar', done, total, finished: true });
    }
    return { frames: frames.length, tiles: done, failed, cancelled: this.cancelled };
  }

  cancel() {
    this.cancelled = true;
  }

  // Forecast grids

  index() {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, 'forecasts', 'index.json'), 'utf8'));
    } catch (e) {
      return [];
    }
  }

  saveIndex(list) {
    fs.writeFileSync(path.join(this.dir, 'forecasts', 'index.json'), JSON.stringify(list));
  }

  // A 12 x 12 grid of 7-day hourly forecasts over the bounds, in one Open-Meteo request.
  async fetchGrid(bounds) {
    if (this.offline()) throw new Error('Offline mode is on');
    const lats = spread(bounds.south, bounds.north, GRID_SIDE);
    const lons = spread(bounds.west, bounds.east, GRID_SIDE);
    const pts = lats.flatMap((la) => lons.map((lo) => [la, lo]));
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + pts.map((p) => p[0]).join(',') + '&longitude=' + pts.map((p) => p[1]).join(',') +
      '&hourly=' + GRID_VARS.join(',') + '&wind_speed_unit=mph&timeformat=unixtime&timezone=GMT&forecast_days=7';
    const res = await this.getJson(url);
    const rows = Array.isArray(res) ? res : [res];
    if (rows.length !== pts.length) throw new Error('Unexpected forecast response');
    const time = rows[0].hourly.time;
    const vars = {};
    for (const v of GRID_VARS) vars[v] = rows.map((r) => r.hourly[v].map((n) => (n == null ? null : Math.round(n * 10) / 10)));
    const at = new Date().toISOString();
    const id = at.replace(/[:.]/g, '-');
    const meta = { id, at, bounds: { south: lats[0], north: lats.at(-1), west: lons[0], east: lons.at(-1) }, from: time[0], to: time.at(-1) };
    fs.writeFileSync(path.join(this.dir, 'forecasts', id + '.json'), JSON.stringify({ ...meta, lats, lons, time, vars }));
    this.saveIndex([meta, ...this.index()]);
    this.prune();
    return meta;
  }

  grid(id) {
    if (!/^[\w-]+$/.test(id)) throw new Error('Bad id');
    return JSON.parse(fs.readFileSync(path.join(this.dir, 'forecasts', id + '.json'), 'utf8'));
  }

  removeGrid(id) {
    if (!/^[\w-]+$/.test(id)) throw new Error('Bad id');
    fs.rmSync(path.join(this.dir, 'forecasts', id + '.json'), { force: true });
    this.saveIndex(this.index().filter((m) => m.id !== id));
  }

  // Flood area outlines. Saved ones are used offline; using one keeps it from being pruned.
  async floodAreas(ids) {
    const out = {};
    for (const id of ids.slice(0, 40)) {
      if (!/^[A-Za-z0-9]+$/.test(id)) continue;
      const p = path.join(this.dir, 'floods', id + '.json');
      try {
        if (fs.existsSync(p)) {
          out[id] = JSON.parse(fs.readFileSync(p, 'utf8'));
          const now = new Date();
          fs.utimesSync(p, now, now);
        } else if (!this.offline()) {
          out[id] = await this.getJson(`https://environment.data.gov.uk/flood-monitoring/id/floodAreas/${id}/polygon`);
          fs.writeFileSync(p, JSON.stringify(out[id]));
        }
      } catch (e) { /* drawn without that outline */ }
    }
    return out;
  }

  // Active tropical storms. These matter to the UK when one heads across the Atlantic as an ex-hurricane.
  async storms() {
    const p = path.join(this.dir, 'storms.json');
    if (!this.offline()) {
      try {
        const j = await this.getJson('https://www.nhc.noaa.gov/CurrentStorms.json');
        const storms = (j.activeStorms || []).map((s) => ({
          name: s.name, classification: s.classification, intensity: Number(s.intensity), pressure: Number(s.pressure),
          lat: Number(s.latitudeNumeric), lon: Number(s.longitudeNumeric), movementDir: Number(s.movementDir), movementSpeed: Number(s.movementSpeed), lastUpdate: s.lastUpdate,
        }));
        fs.writeFileSync(p, JSON.stringify({ at: new Date().toISOString(), storms }));
      } catch (e) { /* fall back to the saved list */ }
    }
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  // Housekeeping

  prune() {
    let files = 0, bytes = 0;
    const rm = (p) => {
      const s = dirSize(p);
      files += s.files;
      bytes += s.bytes;
      fs.rmSync(p, { recursive: true, force: true });
    };
    const now = Date.now();
    const keepMs = this.keepDays() * 86400000;

    for (const f of this.savedFrames()) if (now - f.time * 1000 > RADAR_KEEP_HOURS * 3600000) rm(path.join(this.dir, 'radar', f.key));

    const index = this.index();
    const keep = index.filter((m, i) => i < MAX_FORECASTS && now - new Date(m.at) < keepMs);
    const keepIds = new Set(keep.map((m) => m.id));
    for (const f of fs.readdirSync(path.join(this.dir, 'forecasts'))) {
      if (f !== 'index.json' && !keepIds.has(f.replace(/\.json$/, ''))) rm(path.join(this.dir, 'forecasts', f));
    }
    if (keep.length !== index.length) this.saveIndex(keep);

    for (const f of fs.readdirSync(path.join(this.dir, 'floods'))) {
      const p = path.join(this.dir, 'floods', f);
      if (now - fs.statSync(p).mtimeMs > FLOOD_KEEP_DAYS * 86400000) rm(p);
    }

    const storms = path.join(this.dir, 'storms.json');
    if (fs.existsSync(storms) && now - fs.statSync(storms).mtimeMs > keepMs) rm(storms);
    return { files, bytes };
  }

  stats() {
    return { ...dirSize(this.dir), forecasts: this.index().length, radarFrames: this.savedFrames().length };
  }

  clear() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    this.mkdirs();
  }
}

function spread(a, b, n) {
  return Array.from({ length: n }, (_, i) => Math.round((a + ((b - a) * i) / (n - 1)) * 1000) / 1000);
}

function tilesFor(b, minZ, maxZ) {
  const out = [];
  for (let z = minZ; z <= maxZ; z++) {
    const a = lonLatToTile(b.west, b.north, z);
    const c = lonLatToTile(b.east, b.south, z);
    for (let x = a.x; x <= c.x; x++) for (let y = a.y; y <= c.y; y++) out.push([z, x, y]);
  }
  return out;
}

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

function dirSize(p) {
  let files = 0, bytes = 0;
  if (!fs.existsSync(p)) return { files, bytes };
  const st = fs.statSync(p);
  if (!st.isDirectory()) return { files: 1, bytes: st.size };
  for (const e of fs.readdirSync(p)) {
    const s = dirSize(path.join(p, e));
    files += s.files;
    bytes += s.bytes;
  }
  return { files, bytes };
}

module.exports = { WxCache };
