// Copies of the program for other kinds of computer, for USB backups: a Windows PC can't build the Mac app (and a
// Mac copy of the app can't go on a FAT USB drive as it is), so these come from the latest GitHub release.
// They are downloaded once into <userData>/programs and checked for a newer release at each backup while online.
//
//   programs.json   { tag, files: { [kind]: { name, size } } }
//   <kind> file     mac-apple-silicon.zip, mac-intel.zip, windows.exe
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const REPO = 'owentriggs/holdfast-emergency-planning-system';
// Tests point this at a local server.
const releasesUrl = () => process.env.HOLDFAST_RELEASES_URL || `https://api.github.com/repos/${REPO}/releases/latest`;

// kind: [file kept here, release asset name, where it goes on the drive, label]
const KINDS = {
  'mac-apple-silicon': ['mac-apple-silicon.zip', /mac-apple-silicon\.zip$/i, 'Mac/Holdfast for Apple Silicon Macs.zip', 'Mac (Apple Silicon)'],
  'mac-intel': ['mac-intel.zip', /mac-intel\.zip$/i, 'Mac/Holdfast for Intel Macs.zip', 'Mac (Intel)'],
  windows: ['windows.exe', /^Holdfast[ .].*[ .]\d+\.\d+\.\d+\.exe$/i, 'Windows/Holdfast (Windows, portable).exe', 'Windows'],
};
// What this computer can't copy from itself.
const WANTED = process.platform === 'darwin' ? ['windows', 'mac-apple-silicon', 'mac-intel'] : ['mac-apple-silicon', 'mac-intel'];

class Programs {
  constructor(dir, fetch) {
    this.dir = dir;
    this.fetch = fetch;
  }

  metaFile() { return path.join(this.dir, 'programs.json'); }
  meta() { try { return JSON.parse(fs.readFileSync(this.metaFile(), 'utf8')); } catch (e) { return { tag: null, files: {} }; } }
  has(kind) { const m = this.meta(); return !!m.files[kind] && fs.existsSync(path.join(this.dir, KINDS[kind][0])); }

  // What is kept here now, for the USB page: { wanted: [label], tag, size, missing: [label] }
  status() {
    const m = this.meta();
    return {
      wanted: WANTED.map((k) => KINDS[k][3]),
      tag: m.tag,
      size: WANTED.filter((k) => this.has(k)).reduce((a, k) => a + m.files[k].size, 0),
      missing: WANTED.filter((k) => !this.has(k)).map((k) => KINDS[k][3]),
    };
  }

  // Downloads anything missing or out of date. Offline, or with no release yet, it keeps what it has.
  // Returns { tag, note } where note explains anything that could not be fetched.
  async update(progress) {
    let release;
    try {
      const res = await this.fetch(releasesUrl(), { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Holdfast' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      release = await res.json();
    } catch (e) {
      const st = this.status();
      return { tag: st.tag, note: st.missing.length ? `Could not reach GitHub to download the ${st.missing.join(' and ')} version (${e.message}).` : null };
    }
    const m = this.meta();
    const missing = [];
    fs.mkdirSync(this.dir, { recursive: true });
    for (const kind of WANTED) {
      const [file, pattern, , label] = KINDS[kind];
      const asset = (release.assets || []).find((a) => pattern.test(a.name) && !/setup/i.test(a.name));
      if (!asset) { if (!this.has(kind)) missing.push(label); continue; }
      if (this.has(kind) && m.files[kind].name === asset.name && m.files[kind].size === asset.size) continue;
      progress({ phase: `Downloading the ${label} version`, done: 0, total: 1, file: asset.name });
      const res = await this.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Holdfast' } });
      if (!res.ok) throw new Error(`Downloading ${asset.name}: HTTP ${res.status}`);
      const tmp = path.join(this.dir, file + '.tmp');
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      if (fs.statSync(tmp).size !== asset.size) { fs.rmSync(tmp, { force: true }); throw new Error(`Downloading ${asset.name} did not finish`); }
      fs.renameSync(tmp, path.join(this.dir, file));
      m.files[kind] = { name: asset.name, size: asset.size };
      m.tag = release.tag_name;
      fs.writeFileSync(this.metaFile(), JSON.stringify(m, null, 1));
    }
    return { tag: release.tag_name, note: missing.length ? `Release ${release.tag_name} has no ${missing.join(' or ')} version yet.` : null };
  }

  // [{ src, dest }] for the versions kept here; dest is relative to the backup folder's Programs folder.
  files() {
    return WANTED.filter((k) => this.has(k)).map((k) => ({ kind: k, src: path.join(this.dir, KINDS[k][0]), dest: KINDS[k][2] }));
  }
}

module.exports = { Programs, KINDS, WANTED };
