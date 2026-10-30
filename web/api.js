// window.api for the phone app: the same calls the desktop pages make through preload.js, answered in the browser.
// Plan data and the encrypted vault live in IndexedDB (db.js). They arrive in a "Holdfast phone" file made by a USB
// backup, and edits go back to the computer as a "Holdfast changes" file (pack.js, src/main/phone.js).
//
// meta "copy": { from, created, computer, encrypted, planCheck, importedAt, exportedAt, changed, baseFiles }
//   from        id of the phone file, which the computer uses to find what it sent (its merge base)
//   planCheck   the encrypted plan as it arrived, to check the backup password again before saving changes
//   baseFiles   vault file ids that came from the computer; only files added since go back in the changes file
import * as db from './db.js';
import { readPack, writePack } from './pack.js';
import { scrypt, seal, open, normaliseCode, encryptPlan, decryptPlan, sha256, hex, unb64 } from './crypto.js';

const listeners = {};
const emit = (ch, payload) => (listeners[ch] || []).forEach((fn) => fn(payload));
const notOnPhone = (what) => () => Promise.reject(new Error(`${what} is only available on the computer.`));
const utf8 = (s) => new TextEncoder().encode(s);

async function copyMeta() { return (await db.get('meta', 'copy')) || null; }
async function markChanged() {
  const c = await copyMeta();
  if (c && !c.changed) await db.put('meta', 'copy', { ...c, changed: true });
}

// ---- Vault ----------------------------------------------------------------------------------------------------

const MIMES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', txt: 'text/plain', csv: 'text/csv', md: 'text/plain', json: 'application/json', heic: 'image/heic' };
const mimeFor = (name) => MIMES[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';
const FIELDS = ['name', 'category', 'person', 'reference', 'issuer', 'issued', 'expires', 'original', 'notes'];

const vault = { key: null, index: null, failures: 0, lockedUntil: 0, urls: [] };
const need = () => { if (!vault.key) throw new Error('Vault is locked'); };
const header = () => db.get('vault', 'header');

async function vaultStatus() {
  const hd = await header();
  const st = { exists: !!hd, unlocked: !!vault.key, waitMs: Math.max(0, vault.lockedUntil - Date.now()) };
  if (hd) { st.created = hd.created; st.passwordChanged = hd.passwordChanged; }
  return st;
}
const vaultChanged = async () => emit('vault:changed', await vaultStatus());

async function saveIndex() {
  await db.put('vault', 'index', await seal(vault.key, utf8(JSON.stringify(vault.index)), 'index'));
  await markChanged();
  await vaultChanged();
}

function lock() {
  if (!vault.key) return;
  vault.key.fill(0);
  vault.key = null;
  vault.index = null;
  vault.urls.forEach((u) => URL.revokeObjectURL(u));
  vault.urls = [];
  vaultChanged();
}

async function readFile(fileId) {
  need();
  const f = vault.index.flatMap((it) => it.files).find((x) => x.id === fileId);
  if (!f) throw new Error('File not found');
  return { file: f, data: await open(vault.key, await db.get('files', f.id), 'file:' + f.id) };
}

// A blob: URL for showing a decrypted file. Revoked when the vault locks.
async function fileUrl(fileId) {
  const { file, data } = await readFile(fileId);
  const u = URL.createObjectURL(new Blob([data], { type: file.type || 'application/octet-stream' }));
  vault.urls.push(u);
  return u;
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

async function addFiles(entryId, files) {
  need();
  const it = vault.index.find((x) => x.id === entryId);
  if (!it) throw new Error('Document not found');
  const added = [];
  for (const f of files) {
    const data = new Uint8Array(f.data);
    if (data.length > 250 * 1024 * 1024) throw new Error(`${f.name} is larger than 250 MB`);
    const id = hex(12);
    await db.put('files', id, await seal(vault.key, data, 'file:' + id));
    const rec = { id, name: String(f.name || 'file').split(/[\\/]/).pop(), type: f.type || mimeFor(f.name), size: data.length, sha256: await sha256(data), added: new Date().toISOString() };
    it.files.push(rec);
    added.push(rec);
  }
  it.updated = new Date().toISOString();
  await saveIndex();
  return added;
}

// The phone's file picker, which also offers the camera for photographing a document.
function pickFiles(entryId) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: 'image/*,application/pdf,.txt,.csv' });
    input.onchange = async () => {
      const files = [];
      for (const f of input.files) files.push({ name: f.name, type: f.type, data: new Uint8Array(await f.arrayBuffer()) });
      resolve(files.length ? await addFiles(entryId, files) : []);
    };
    input.click();
  });
}

// Lock after the vault's idle time with no taps or keys, and when the app is closed.
let lastActive = Date.now();
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => (lastActive = Date.now()), true);
addEventListener('pagehide', lock);
setInterval(async () => {
  if (!vault.key) return;
  const s = (await db.get('plan', 'settings')) || {};
  const mins = Number(s.vaultAutoLock ?? 5);
  if (mins > 0 && Date.now() - lastActive >= mins * 60000) lock();
}, 15000);

const vaultApi = {
  status: vaultStatus,
  create: notOnPhone('Setting up the vault'),
  async unlock(secret, useRecovery = false) {
    const wait = vault.lockedUntil - Date.now();
    if (wait > 0) throw new Error(`Too many attempts. Try again in ${Math.ceil(wait / 1000)} s`);
    const hd = await header();
    if (!hd) throw new Error('There is no vault on this phone');
    const slot = useRecovery ? 'recovery' : 'password';
    try {
      const kek = await scrypt(useRecovery ? normaliseCode(secret) : String(secret), unb64(hd.slots[slot].salt), hd.kdf);
      vault.key = await open(kek, unb64(hd.slots[slot].box), 'slot:' + slot);
    } catch (e) {
      vault.failures++;
      if (vault.failures >= 3) vault.lockedUntil = Date.now() + Math.min(60, 2 ** (vault.failures - 3) * 5) * 1000;
      throw new Error(useRecovery ? 'Recovery code is not correct' : 'Password is not correct');
    }
    vault.failures = 0;
    const idx = await db.get('vault', 'index');
    vault.index = idx ? JSON.parse(new TextDecoder().decode(await open(vault.key, idx, 'index'))) : [];
    lastActive = Date.now();
    await vaultChanged();
    return true;
  },
  lock: async () => lock(),
  changePassword: notOnPhone('Changing the vault password'),
  list: async () => { need(); return vault.index; },
  async saveEntry(entry) {
    need();
    let it = vault.index.find((x) => x.id === entry.id);
    if (!it) {
      it = { id: hex(8), added: new Date().toISOString(), files: [] };
      vault.index.push(it);
    }
    for (const f of FIELDS) if (f in entry) it[f] = String(entry[f] ?? '');
    it.updated = new Date().toISOString();
    await saveIndex();
    return it;
  },
  async removeEntry(id) {
    need();
    const it = vault.index.find((x) => x.id === id);
    if (!it) return;
    for (const f of it.files) await db.del('files', f.id);
    vault.index = vault.index.filter((x) => x !== it);
    await saveIndex();
  },
  addFiles,
  pickFiles,
  async removeFile(entryId, fileId) {
    need();
    const it = vault.index.find((x) => x.id === entryId);
    if (!it) return;
    it.files = it.files.filter((f) => f.id !== fileId);
    await db.del('files', fileId);
    await saveIndex();
  },
  async saveCopy(fileId) {
    const { file, data } = await readFile(fileId);
    download(new Blob([data], { type: file.type }), file.name);
    return { ok: true, path: 'Downloads' };
  },
  async openExternal(fileId) { window.open(await fileUrl(fileId), '_blank'); return true; },
  fileUrl,
  async stats() { const k = await db.keys('files'); return { files: k.length, bytes: 0 }; },
  backup: notOnPhone('Backing up the vault on its own'),
  restore: notOnPhone('Restoring the vault on its own'),
  destroy: notOnPhone('Deleting the vault'),
};

// ---- Phone copy: in from the computer, changes back out --------------------------------------------------------

const phoneApi = {
  status: copyMeta,

  // file: the "Holdfast phone" file chosen from the USB drive. Replaces everything on the phone.
  async importFile(file, password) {
    const { header: hd, blob } = await readPack(file);
    if (hd.format === 'holdfast-phone-changes') throw new Error('That is a changes file made on a phone. Open "Holdfast phone.holdfast" from the backup instead.');
    if (hd.format !== 'holdfast-phone') throw new Error('This is not a Holdfast phone file');
    let plan = JSON.parse(await blob('plan').text());
    let planCheck = null;
    if (plan.format === 'eps-plan-enc') {
      if (!password) throw new Error('PASSWORD_NEEDED');
      planCheck = plan;
      plan = await decryptPlan(plan, password);
    }
    const contents = { plan, vault: {}, files: {}, meta: {} };
    const baseFiles = [];
    if (hd.vault) {
      contents.vault.header = JSON.parse(await blob('vault/vault.json').text());
      if (blob('vault/index.bin')) contents.vault.index = new Uint8Array(await blob('vault/index.bin').arrayBuffer());
      for (const name of Object.keys(hd.blobs)) {
        const m = /^vault\/files\/([0-9a-f]+)\.bin$/.exec(name);
        if (!m) continue;
        contents.files[m[1]] = new Uint8Array(await blob(name).arrayBuffer());
        baseFiles.push(m[1]);
      }
    }
    contents.meta.copy = { from: hd.id, created: hd.created, computer: hd.computer || '', encrypted: !!planCheck, planCheck, importedAt: new Date().toISOString(), exportedAt: null, changed: false, baseFiles };
    lock();
    await db.replace(contents);
    return contents.meta.copy;
  },

  // Everything the computer needs to merge the phone's edits. Returns { blob, name }.
  async exportChanges(password) {
    const c = await copyMeta();
    if (!c) throw new Error('Nothing to send: open a phone file from the computer first.');
    let plan = await db.all('plan');
    if (c.encrypted) {
      if (!password) throw new Error('PASSWORD_NEEDED');
      await decryptPlan(c.planCheck, password); // throws PASSWORD_WRONG
      plan = await encryptPlan(plan, password);
    }
    const parts = [['plan', utf8(JSON.stringify(plan))]];
    const hd = await header();
    if (hd) {
      parts.push(['vault/vault.json', utf8(JSON.stringify(hd))]);
      const idx = await db.get('vault', 'index');
      if (idx) parts.push(['vault/index.bin', idx]);
      const base = new Set(c.baseFiles);
      for (const id of await db.keys('files')) if (!base.has(id)) parts.push([`vault/files/${id}.bin`, await db.get('files', id)]);
    }
    const now = new Date();
    const blob = writePack({ format: 'holdfast-phone-changes', version: 1, from: c.from, created: now.toISOString() }, parts);
    const stamp = now.toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
    await db.put('meta', 'copy', { ...c, exportedAt: now.toISOString(), changed: false });
    return { blob, name: `Holdfast changes ${stamp}.holdfast` };
  },

  // Hands the changes file to the phone's share sheet (save to Files, a USB drive, email...) or downloads it.
  async save({ blob, name }) {
    const file = new File([blob], name, { type: 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return { ok: true, shared: true }; } catch (e) { if (e.name === 'AbortError') return { ok: false }; }
    }
    download(blob, name);
    return { ok: true, shared: false };
  },
};

// ---- Everything else ------------------------------------------------------------------------------------------

const pending = new Set();
window.api = {
  platform: 'web',
  store: {
    all: () => db.all('plan'),
    async set(key, value) { await db.put('plan', key, value); if (key !== 'settings') await markChanged(); return true; },
    // Browsers cannot write synchronously; start the write and let the page carry on.
    setSync(key, value) { const p = db.put('plan', key, value).finally(() => pending.delete(p)); pending.add(p); if (key !== 'settings') markChanged(); return true; },
  },
  net: {
    async get(url, as = 'json') {
      if (!/^https:\/\//.test(url)) throw new Error('Only https URLs are allowed');
      const res = await fetch(url, { headers: { Accept: as === 'json' ? 'application/json' : '*/*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      return as === 'json' ? res.json() : res.text();
    },
  },
  vault: vaultApi,
  phone: phoneApi,
  webcache: { stats: async () => ({ pages: 0, bytes: 0 }) },
  tiles: { stats: async () => ({ files: 0, bytes: 0 }) },
  wx: { stats: async () => ({ forecasts: 0, radarFrames: 0, bytes: 0 }) },
  usb: { syncStatus: async () => [], present: async () => [] },
  print: {},
  backup: {},
  app: {
    info: async () => ({ version: 'phone', dataRoot: 'Stored in this browser on this phone' }),
    openExternal: async (url) => /^https?:/.test(url) && !!window.open(url, '_blank', 'noopener'),
    openDataFolder: notOnPhone('The data folder'),
  },
  on(ch, fn) {
    (listeners[ch] = listeners[ch] || []).push(fn);
    return () => { listeners[ch] = listeners[ch].filter((f) => f !== fn); };
  },
};

// Offline: the service worker (written by scripts/build-web.js) keeps a copy of the app on the phone.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
