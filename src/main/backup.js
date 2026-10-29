// Backup to a USB stick or external drive, and restore from one.
//
// Layout written to <target>/Holdfast Backup (backups made before the rename used "EPS Backup"; they are still read and get renamed on the next backup):
//   README.txt                       what is here and how to use it
//   Emergency plan <date>.pdf        optional, readable on any computer
//   backup.json                      manifest, written last ("complete": true)
//   Data/data/*.json                 plan data (or Data/plan.epsenc when protected with a password)
//   Data/vault, Data/webcache, Data/tiles
//   Start Holdfast                   optional copy of the program: the portable .exe itself, or a launcher .exe for App/
//   App/                             the installed program's files, when copied from an installed app
//   .holdfast-index.json             size, time and sha256 of each file written, so unchanged files are not copied again
//
// Folders are synced: unchanged files are skipped (same size and modified time, or the same content as the index
// records when only the time changed), files no longer present are removed, so repeat backups are quick.
const { execFile } = require('child_process');
const crypto = require('crypto');
// original-fs: Electron's patched fs treats .asar archives as folders, which breaks copying the program itself.
const fs = process.versions.electron ? require('original-fs') : require('fs');
const path = require('path');
const { seal, open, scrypt, KDF, MAXMEM } = require('./vault');
const { mergePlan, SKIP_KEYS } = require('./merge');

const FOLDER = 'Holdfast Backup';
const LAUNCHER = 'Start Holdfast';
const PORTABLE = 'holdfast-portable.json';
const INDEX = '.holdfast-index.json';
// Names used before the app was renamed to Holdfast.
const LEGACY = { folder: 'EPS Backup', launcher: 'Start Emergency Planning System', portable: 'eps-portable.json' };

// The backup folder for a drive or folder: the folder itself if given, otherwise the current name, or the old name if only that exists.
function backupRoot(target) {
  const base = path.basename(target);
  if (base === FOLDER || base === LEGACY.folder) return target;
  const now = path.join(target, FOLDER);
  const old = path.join(target, LEGACY.folder);
  return !fs.existsSync(now) && fs.existsSync(old) ? old : now;
}
const DRIVE_TYPES = { 2: 'Removable', 3: 'Local disk', 4: 'Network', 5: 'CD/DVD' };

function ps(command) {
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 20000 }, (err, out) => (err ? reject(err) : resolve(out))));
}

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (!/\.(tmp|bak)$/.test(e.name)) out.push(path.relative(base, p));
  }
  return out;
}

// File times within FAT's 2 second resolution. loose: also an exact hour out, as FAT drives store local time
// and Windows reads them an hour off after the clocks change.
function sameTime(x, y, loose) {
  const d = Math.abs(x - y);
  return d < 2000 || (loose && Math.abs(d - 3600000) < 2000);
}

function hashFile(f) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function dirSize(dir) {
  return walk(dir).reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);
}

// Where the program itself lives: the portable exe, or the installed folder. Null when running from source.
function appSource(app) {
  if (!app.isPackaged) return null;
  if (process.env.PORTABLE_EXECUTABLE_FILE) return { kind: 'file', path: process.env.PORTABLE_EXECUTABLE_FILE };
  return { kind: 'dir', path: path.dirname(process.execPath) };
}

class UsbBackup {
  constructor(app, dataRoot, store, emit, vault) {
    this.app = app;
    this.vault = vault;
    this.syncCache = new Map();
    this.dataRoot = dataRoot;
    this.store = store;
    this.emit = emit;
    this.cancelled = false;
  }

  async drives() {
    const out = await ps('Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,Size,FreeSpace,DriveType,FileSystem | ConvertTo-Json');
    const list = [].concat(JSON.parse(out || '[]'));
    const sys = (process.env.SystemDrive || 'C:').toUpperCase();
    return list.filter((d) => d.DeviceID && d.DeviceID.toUpperCase() !== sys && d.Size).map((d) => {
      const root = d.DeviceID + '\\';
      return {
        id: d.DeviceID, root, label: d.VolumeName || '', size: Number(d.Size), free: Number(d.FreeSpace), fs: d.FileSystem || '',
        type: DRIVE_TYPES[d.DriveType] || 'Other', removable: d.DriveType === 2,
        manifest: this.readManifest(backupRoot(root)),
      };
    });
  }

  estimate() {
    const src = appSource(this.app);
    return {
      plan: dirSize(path.join(this.dataRoot, 'data')),
      vault: dirSize(path.join(this.dataRoot, 'vault')),
      vaultExists: fs.existsSync(path.join(this.dataRoot, 'vault', 'vault.json')),
      library: dirSize(path.join(this.dataRoot, 'webcache')),
      tiles: dirSize(path.join(this.dataRoot, 'tiles')),
      app: src ? (src.kind === 'file' ? fs.statSync(src.path).size : dirSize(src.path)) : 0,
      appAvailable: !!src,
    };
  }

  readManifest(folder) {
    try { return JSON.parse(fs.readFileSync(path.join(folder, 'backup.json'), 'utf8')); } catch (e) { return null; }
  }

  cancel() { this.cancelled = true; }

  progress(p) { this.emit('backup:progress', p); }

  // The drive's index of what backups wrote to it: { [folder or file]: entry or { [path in folder]: entry } },
  // where an entry is { s: size, m: modified time, h: sha256 }.
  loadIndex(root) {
    try { return JSON.parse(fs.readFileSync(path.join(root, INDEX), 'utf8')); } catch (e) { return {}; }
  }

  // Copies a to b unless b already holds the same content. Returns { copied, entry } with b's new index entry
  // (only when track is set: making an entry reads the whole of a).
  // Same size and time: skipped straight away. Same size but a different time (a reinstalled program whose files
  // all get new dates, or a FAT drive read after the clocks change): skipped if b is untouched since the last
  // backup and a's content matches what was written then; only b's date is updated.
  async copyIfChanged(a, b, prev, track) {
    const sa = fs.statSync(a);
    let sb = null;
    try { sb = fs.statSync(b); } catch (e) { /* not there yet */ }
    const known = (e, size, m) => e && e.s === size && e.h && sameTime(e.m, m, true);
    const entry = async (h) => (track ? { s: sa.size, m: sa.mtimeMs, h: h || (await hashFile(a)) } : null);
    if (sb && sb.size === sa.size) {
      if (sameTime(sb.mtimeMs, sa.mtimeMs)) return { copied: false, entry: known(prev, sa.size, sa.mtimeMs) ? prev : await entry() };
      if (known(prev, sb.size, sb.mtimeMs)) {
        const h = await hashFile(a);
        if (h === prev.h) {
          fs.utimesSync(b, sa.atime, sa.mtime);
          return { copied: false, entry: await entry(h) };
        }
      }
    }
    fs.mkdirSync(path.dirname(b), { recursive: true });
    await fs.promises.copyFile(a, b);
    fs.utimesSync(b, sa.atime, sa.mtime);
    return { copied: true, entry: await entry(), size: sa.size };
  }

  // Mirror src into dest. idx: the index entries for dest, updated in place when given. Returns { copied, skipped, removed, bytes }.
  async sync(src, dest, label, skip, idx) {
    const files = walk(src).filter((f) => !(skip && skip.test(f)));
    const st = { copied: 0, skipped: 0, removed: 0, bytes: 0 };
    fs.mkdirSync(dest, { recursive: true });
    const next = {};
    let i = 0;
    for (const rel of files) {
      if (this.cancelled) throw new Error('Cancelled');
      const r = await this.copyIfChanged(path.join(src, rel), path.join(dest, rel), idx && idx[rel], !!idx);
      next[rel] = r.entry;
      if (r.copied) { st.copied++; st.bytes += r.size; } else st.skipped++;
      if (++i % 25 === 0 || i === files.length) this.progress({ phase: label, done: i, total: files.length, file: rel });
    }
    if (idx) { for (const k of Object.keys(idx)) delete idx[k]; Object.assign(idx, next); }
    const keep = new Set(files.map((f) => f.toLowerCase()));
    for (const rel of walk(dest)) if (!keep.has(rel.toLowerCase())) { fs.rmSync(path.join(dest, rel), { force: true }); st.removed++; }
    return st;
  }

  // opts: { plan, password, vault, library, tiles, app, pdf: Buffer|null }
  async run(target, opts) {
    this.cancelled = false;
    let root = backupRoot(target);
    const old = this.readManifest(root);
    // Never overwrite changes made on the drive (by the program copy on another computer) without asking.
    if (old && (opts.plan || opts.vault) && !opts.overwrite && this.editedSince(root, old)) {
      const p = await this.preview(target);
      if (p.usbChanges || p.vault.state === 'locked') throw new Error(`USB_HAS_CHANGES: The drive has ${p.usbChanges || 'some'} change(s) made on another computer. Review them first.`);
    }
    // A backup made before the rename: give its folder the new name.
    if (path.basename(root) === LEGACY.folder) {
      const renamed = path.join(path.dirname(root), FOLDER);
      try { fs.renameSync(root, renamed); root = renamed; } catch (e) { /* in use: keep writing to the old folder */ }
    }
    const data = path.join(root, 'Data');
    fs.mkdirSync(data, { recursive: true });
    const index = this.loadIndex(root);
    const id = (old && old.id) || crypto.randomBytes(8).toString('hex');
    // Mark as in progress until the manifest is rewritten at the end.
    fs.writeFileSync(path.join(root, 'backup.json'), JSON.stringify({ ...(old || {}), complete: false, started: new Date().toISOString() }, null, 1));
    const contents = {};
    const steps = [];

    if (opts.plan) {
      this.progress({ phase: 'Plan data', done: 0, total: 1 });
      if (opts.password) {
        const salt = crypto.randomBytes(16);
        const key = await scrypt(String(opts.password), salt, 32, { ...KDF, maxmem: MAXMEM });
        const blob = seal(key, Buffer.from(JSON.stringify(this.store.all())), 'plan');
        fs.writeFileSync(path.join(data, 'plan.epsenc'), JSON.stringify({ format: 'eps-plan-enc', version: 1, kdf: { ...KDF, salt: salt.toString('base64') }, data: blob.toString('base64') }));
        fs.rmSync(path.join(data, 'data'), { recursive: true, force: true });
        delete index['Data/data'];
        contents.plan = { encrypted: true };
      } else {
        steps.push(['Plan data', 'data']);
        fs.rmSync(path.join(data, 'plan.epsenc'), { force: true });
        contents.plan = { encrypted: false };
      }
    }
    if (opts.vault) steps.push(['Document vault', 'vault']);
    if (opts.library) steps.push(['Offline library', 'webcache']);
    if (opts.tiles) steps.push(['Map tiles', 'tiles']);
    for (const [label, dir] of steps) {
      const r = await this.sync(path.join(this.dataRoot, dir), path.join(data, dir), label, null, (index['Data/' + dir] = index['Data/' + dir] || {}));
      const key = { data: 'plan', vault: 'vault', webcache: 'library', tiles: 'tiles' }[dir];
      contents[key] = { ...(contents[key] || {}), ...r };
    }
    // Sections not chosen this time keep whatever an earlier backup left; the manifest says so.
    for (const k of ['plan', 'vault', 'library', 'tiles']) if (!contents[k] && old && old.contents && old.contents[k]) contents[k] = { ...old.contents[k], fromEarlier: old.created };

    if (opts.app) {
      const src = appSource(this.app);
      if (src) {
        if (src.kind === 'file') {
          // The portable build is one exe: put it at the top of the backup folder, next to the data.
          this.progress({ phase: 'Program', done: 0, total: 1, file: path.basename(src.path) });
          index.exe = (await this.copyIfChanged(src.path, path.join(root, LAUNCHER + '.exe'), index.exe, true)).entry;
          fs.writeFileSync(path.join(root, PORTABLE), JSON.stringify({ dataDir: 'Data' }, null, 1));
          fs.rmSync(path.join(root, LAUNCHER + '.cmd'), { force: true });
        } else {
          // An installed copy is a folder of support files. Keep them in App and put a launcher at the top.
          const dest = path.join(root, 'App');
          await this.sync(src.path, dest, 'Program', /^Uninstall .*\.exe$/i, (index.App = index.App || {}));
          fs.writeFileSync(path.join(dest, PORTABLE), JSON.stringify({ dataDir: '../Data' }, null, 1));
          fs.rmSync(path.join(dest, LEGACY.portable), { force: true });
          // A small exe with the Holdfast icon (build/launcher.cs); the .cmd is only for builds without it.
          const exe = path.join(process.resourcesPath || '', 'launcher.exe');
          if (process.resourcesPath && fs.existsSync(exe)) {
            index.exe = (await this.copyIfChanged(exe, path.join(root, LAUNCHER + '.exe'), index.exe, true)).entry;
            fs.rmSync(path.join(root, LAUNCHER + '.cmd'), { force: true });
          } else {
            fs.writeFileSync(path.join(root, LAUNCHER + '.cmd'), `@start "" "%~dp0App\\${path.basename(process.execPath)}"\r\n`);
            fs.rmSync(path.join(root, LAUNCHER + '.exe'), { force: true });
            delete index.exe;
          }
        }
        for (const f of [LEGACY.launcher + '.exe', LEGACY.launcher + '.cmd', LEGACY.portable]) fs.rmSync(path.join(root, f), { force: true });
        contents.app = { version: this.app.getVersion(), kind: src.kind };
      }
    }

    if (opts.pdf) {
      for (const f of fs.readdirSync(root)) if (/^Emergency plan .*\.pdf$/.test(f)) fs.rmSync(path.join(root, f), { force: true });
      fs.writeFileSync(path.join(root, `Emergency plan ${new Date().toISOString().slice(0, 10)}.pdf`), Buffer.from(opts.pdf));
      contents.pdf = true;
    }

    fs.writeFileSync(path.join(root, 'README.txt'), readme(contents));
    fs.writeFileSync(path.join(root, INDEX), JSON.stringify(index));
    const manifest = { format: 'eps-backup-folder', version: 1, id, created: new Date().toISOString(), appVersion: this.app.getVersion(), computer: require('os').hostname(), contents, complete: true };
    fs.writeFileSync(path.join(root, 'backup.json'), JSON.stringify(manifest, null, 1));
    this.saveBase(id, { plan: opts.plan, vault: opts.vault });
    this.syncCache.clear();
    this.progress({ phase: 'Finished', done: 1, total: 1 });
    return { ok: true, path: root, manifest };
  }

  // ---- Two-way sync with a drive that was used on another computer ----------------------------
  // At each backup this computer keeps a copy of what it wrote (the "base"), so later it can tell which side changed.

  baseFile(id, ext) { return path.join(this.dataRoot, 'sync-bases', id + ext); }

  saveBase(id, what) {
    fs.mkdirSync(path.join(this.dataRoot, 'sync-bases'), { recursive: true });
    if (what.plan) {
      const plan = Object.fromEntries(Object.entries(this.store.all()).filter(([k]) => !SKIP_KEYS.has(k)));
      fs.writeFileSync(this.baseFile(id, '.json'), JSON.stringify(plan));
    }
    // The vault base stays encrypted: it is a copy of the vault's own index file.
    const idx = path.join(this.dataRoot, 'vault', 'index.bin');
    if (what.vault && fs.existsSync(idx)) fs.copyFileSync(idx, this.baseFile(id, '.vault.bin'));
  }

  loadBase(id) {
    const read = (ext, json) => { try { const b = fs.readFileSync(this.baseFile(id, ext)); return json ? JSON.parse(b.toString('utf8')) : b; } catch (e) { return null; } };
    return id ? { plan: read('.json', true), vault: read('.vault.bin', false) } : { plan: null, vault: null };
  }

  // Plan data the program copy edits lives in Data/data as plain files. A password-protected backup has none.
  readUsbPlan(root) {
    const dir = path.join(root, 'Data', 'data');
    if (!fs.existsSync(dir)) return null;
    const out = {};
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) { try { out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { /* half-written file */ } }
    return out;
  }

  // Cheap check: has anything on the drive been written since the backup? (Backups keep this computer's file times.)
  editedSince(root, m) {
    const since = Date.parse((m && m.created) || 0) + 2000;
    const files = [];
    const dir = path.join(root, 'Data', 'data');
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.json') && f !== 'settings.json') files.push(path.join(dir, f));
    files.push(path.join(root, 'Data', 'vault', 'index.bin'));
    return files.some((f) => { try { return fs.statSync(f).mtimeMs > since; } catch (e) { return false; } });
  }

  // Compares the drive with this computer. target: drive root, or the backup folder itself.
  async preview(target, choices = {}) {
    const root = backupRoot(target);
    const m = this.readManifest(root);
    const base = this.loadBase(m && m.id);
    const out = { root, manifest: m, hasBase: !!base.plan, edited: this.editedSince(root, m), changes: [], usbChanges: 0, pcChanges: 0, vault: { state: 'none' } };
    // What this computer changed since it last backed up to the drive: comparing with the base alone, every difference is ours.
    out.since = base.plan ? mergePlan(base.plan, this.store.all(), base.plan).pcList : null;
    const usbPlan = this.readUsbPlan(root);
    if (usbPlan) {
      const r = mergePlan(base.plan, this.store.all(), usbPlan, choices);
      out.plan = r;
      out.changes.push(...r.changes);
      out.pcChanges += r.pcChanges;
    }
    const usbIdxFile = path.join(root, 'Data', 'vault', 'index.bin');
    if (fs.existsSync(usbIdxFile) && this.vault && this.vault.exists()) {
      const usbBuf = fs.readFileSync(usbIdxFile);
      const pcBuf = fs.readFileSync(path.join(this.dataRoot, 'vault', 'index.bin'));
      if ((base.vault && usbBuf.equals(base.vault)) || usbBuf.equals(pcBuf)) out.vault = { state: 'same' };
      // Without a base (backup from an older version) a locked vault cannot be judged, so it is not flagged.
      else if (!this.vault.isUnlocked()) out.vault = { state: base.vault ? 'locked' : 'unknown' };
      else {
        try {
          const usbIdx = this.vault.openIndex(usbBuf);
          const baseIdx = base.vault ? this.vault.openIndex(base.vault) : null;
          const r = mergePlan(baseIdx ? { vault: baseIdx } : null, { vault: this.vault.list() }, { vault: usbIdx }, choices, { all: true });
          out.vault = { state: 'compared', result: r.result.vault, changed: r.changed.length > 0 };
          out.changes.push(...r.changes);
          out.pcChanges += r.pcChanges;
        } catch (e) {
          out.vault = { state: 'different' };
        }
      }
    }
    out.usbChanges = out.changes.filter((c) => c.kind !== 'only-pc').length;
    return out;
  }

  // Applies the chosen changes to this computer, then writes the merged result back to the drive so both match.
  async apply(target, choices) {
    const p = await this.preview(target, choices);
    const root = p.root;
    if (p.vault.state === 'locked') throw new Error('Unlock the document vault first so its changes can be compared');
    if (p.plan) for (const k of p.plan.changed) { this.store.set(k, p.plan.result[k]); this.emit('store:changed', { key: k, value: p.plan.result[k] }); }
    if (p.vault.state === 'compared' && p.vault.changed) this.vault.applyMerged(p.vault.result, path.join(root, 'Data', 'vault', 'files'));
    if (fs.existsSync(path.join(root, 'Data', 'data'))) await this.sync(path.join(this.dataRoot, 'data'), path.join(root, 'Data', 'data'), 'Plan data');
    const vaultOnDrive = p.vault.state === 'compared' || p.vault.state === 'same';
    if (vaultOnDrive) await this.sync(path.join(this.dataRoot, 'vault'), path.join(root, 'Data', 'vault'), 'Document vault');
    const m = { ...p.manifest, id: (p.manifest && p.manifest.id) || crypto.randomBytes(8).toString('hex'), created: new Date().toISOString(), synced: true, complete: true };
    fs.writeFileSync(path.join(root, 'backup.json'), JSON.stringify(m, null, 1));
    this.saveBase(m.id, { plan: true, vault: vaultOnDrive });
    this.syncCache.clear();
    this.progress({ phase: 'Finished', done: 1, total: 1 });
    return { ok: true, applied: p.changes.filter((c) => c.choice === 'usb').length, keys: p.plan ? p.plan.changed : [] };
  }

  // Looks for backup drives with changes made elsewhere. Run on a timer; a drive is only re-compared when its files change.
  async scan() {
    const found = [];
    for (let c = 68; c <= 90; c++) {
      const drive = String.fromCharCode(c) + ':';
      if (this.dataRoot.toUpperCase().startsWith(drive)) continue;
      const root = backupRoot(drive + path.sep);
      let m;
      try { if (!fs.existsSync(path.join(root, 'backup.json'))) continue; m = this.readManifest(root); } catch (e) { continue; }
      if (!m || !m.complete || !this.editedSince(root, m)) continue;
      const mt = (d) => { try { return fs.statSync(path.join(root, 'Data', d)).mtimeMs; } catch (e) { return 0; } };
      const sig = [m.created, this.vault && this.vault.isUnlocked(), mt('data'), mt('vault')].join();
      let st = this.syncCache.get(drive);
      if (!st || st.sig !== sig) {
        try {
          const p = await this.preview(drive + path.sep);
          st = { sig, drive, usbChanges: p.usbChanges, conflicts: p.changes.filter((x) => x.kind === 'conflict').length, vault: p.vault.state };
        } catch (e) { st = { sig, drive, usbChanges: 0, conflicts: 0, vault: 'none' }; }
        this.syncCache.set(drive, st);
      }
      if (st.usbChanges || st.vault === 'locked') found.push(st);
    }
    return found.map(({ sig, ...x }) => x);
  }

  // Reads the plan data from a backup folder, decrypting it when needed.
  async readPlan(root, password) {
    const enc = path.join(root, 'Data', 'plan.epsenc');
    if (fs.existsSync(enc)) {
      if (!password) throw new Error('This backup is password protected');
      const f = JSON.parse(fs.readFileSync(enc, 'utf8'));
      const key = await scrypt(String(password), Buffer.from(f.kdf.salt, 'base64'), 32, { N: f.kdf.N, r: f.kdf.r, p: f.kdf.p, maxmem: MAXMEM });
      try { return JSON.parse(open(key, Buffer.from(f.data, 'base64'), 'plan').toString('utf8')); } catch (e) { throw new Error('Backup password is not correct'); }
    }
    const dir = path.join(root, 'Data', 'data');
    if (!fs.existsSync(dir)) return null;
    const out = {};
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return out;
  }

  // opts: { plan, vault, library, tiles, password }. Current data is copied to <userData>/before-restore-<time> first.
  async restore(root, opts, vault) {
    root = backupRoot(root);
    const m = this.readManifest(root);
    if (!m || m.format !== 'eps-backup-folder') throw new Error('No Holdfast backup found in that folder');
    const saved = path.join(this.dataRoot, 'before-restore-' + new Date().toISOString().replace(/[:.]/g, '-'));
    const done = [];
    let plan = null;
    if (opts.plan || opts.library) plan = await this.readPlan(root, opts.password);
    if (opts.plan) {
      if (!plan) throw new Error('The backup has no plan data');
      fs.cpSync(path.join(this.dataRoot, 'data'), path.join(saved, 'data'), { recursive: true });
      // Keep this computer's record of when it was last backed up.
      const cur = this.store.get('settings', {});
      if (plan.settings) plan.settings = { ...plan.settings, lastUsbBackup: cur.lastUsbBackup, lastUsbTarget: cur.lastUsbTarget };
      this.store.replaceAll(plan);
      done.push('plan');
    }
    if (opts.vault && fs.existsSync(path.join(root, 'Data', 'vault', 'vault.json'))) {
      vault.restoreFrom(path.join(root, 'Data', 'vault'));
      done.push('vault');
    }
    for (const [key, dir] of [['library', 'webcache'], ['tiles', 'tiles']]) {
      if (!opts[key] || !fs.existsSync(path.join(root, 'Data', dir))) continue;
      await this.sync(path.join(root, 'Data', dir), path.join(this.dataRoot, dir), key === 'library' ? 'Offline library' : 'Map tiles');
      if (key === 'library' && plan && plan.webcache) this.store.set('webcache', plan.webcache);
      done.push(key);
    }
    this.progress({ phase: 'Finished', done: 1, total: 1 });
    return { ok: true, restored: done, savedTo: fs.existsSync(saved) ? saved : null };
  }

  // Drives plugged in now that hold a Holdfast backup. Cheap enough to run every couple of seconds.
  present() {
    const out = [];
    for (let c = 68; c <= 90; c++) {
      const drive = String.fromCharCode(c) + ':';
      if (this.dataRoot.toUpperCase().startsWith(drive)) continue;
      const root = backupRoot(drive + path.sep);
      try { if (!fs.existsSync(path.join(root, 'backup.json'))) continue; } catch (e) { continue; }
      const m = this.readManifest(root);
      out.push({ drive, created: (m && (m.created || m.started)) || null, complete: !!(m && m.complete) });
    }
    return out;
  }

  // Windows' "Eject" verb returns at once and may silently refuse (files in use), so wait until the drive has actually gone.
  async eject(driveId) {
    if (!/^[A-Z]:$/i.test(driveId)) throw new Error('Bad drive');
    await ps(`(New-Object -ComObject Shell.Application).Namespace(17).ParseName('${driveId}').InvokeVerb('Eject')`);
    for (let i = 0; i < 40; i++) {
      if (!fs.existsSync(driveId + path.sep)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Windows could not eject ${driveId}. Close any files or windows using it and try again.`);
  }
}

function readme(c) {
  const lines = [
    'HOLDFAST EMERGENCY PLANNING SYSTEM BACKUP',
    `Made ${new Date().toLocaleString('en-GB')}`,
    '',
    'What is here:',
    c.pdf ? '- "Emergency plan ....pdf": the full printed plan. Opens on any computer or phone. Not password protected.' : null,
    c.plan ? (c.plan.encrypted ? '- Data\\plan.epsenc: your plan data, protected with the backup password.' : '- Data\\data: your plan data as JSON files. Not password protected.') : null,
    c.vault ? '- Data\\vault: the document vault. Encrypted; opens with the vault password or recovery code.' : null,
    c.library ? '- Data\\webcache: saved web pages for the offline library.' : null,
    c.tiles ? '- Data\\tiles: offline map tiles.' : null,
    c.app ? '- "Start Holdfast": double-click it on any Windows PC to run the program from this drive. It opens this backup directly.' : null,
    '',
    'To restore on another computer: install or run Holdfast Emergency Planning System, open "USB Backup", click "Restore from a backup" and choose this folder.',
    '',
    'Keep this drive somewhere safe, for example in your grab bag. Anyone who has it can read any part that is not password protected.',
  ];
  return lines.filter((l) => l != null).join('\r\n');
}

module.exports = { UsbBackup, FOLDER, PORTABLE, LEGACY, backupRoot };
