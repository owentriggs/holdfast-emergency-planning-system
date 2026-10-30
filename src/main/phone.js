// Files that carry the plan to the phone app and its changes back.
//
//   Holdfast phone.holdfast             written by a USB backup: the plan and the encrypted vault, for the phone to open
//   Holdfast changes <time>.holdfast    written by the phone: its whole plan and vault index, plus files added on the phone
//
// Both are one file, because a phone browser can open a single file from a USB drive but not a folder:
//   "HFPK1\n" | header length (uint32 BE) | header JSON | blobs
// header.blobs maps a name to [offset, length] within the blobs. Names: "plan" (JSON, or an eps-plan-enc wrapper when
// protected with the backup password), "vault/vault.json", "vault/index.bin" and "vault/files/<id>.bin". Vault blobs
// are copied as they are, still encrypted with the vault's key.
//
// Changes come back in through the USB sync review: the file is unpacked into a temporary folder laid out like a
// backup drive, and compared against the base this computer saved when it wrote the phone file.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { seal, open, scrypt, KDF, MAXMEM } = require('./vault');

const MAGIC = Buffer.from('HFPK1\n');
const PHONE_FILE = 'Holdfast phone.holdfast';
const CHANGES = /^Holdfast changes .*\.holdfast$/i;
const MERGED = ' (merged)';

async function encryptPlan(plan, password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, 32, { ...KDF, maxmem: MAXMEM });
  const blob = seal(key, Buffer.from(JSON.stringify(plan)), 'plan');
  return { format: 'eps-plan-enc', version: 1, kdf: { ...KDF, salt: salt.toString('base64') }, data: blob.toString('base64') };
}

async function decryptPlan(enc, password) {
  if (!password) throw new Error('PASSWORD_NEEDED: The plan in this file is protected with the backup password.');
  const key = await scrypt(String(password), Buffer.from(enc.kdf.salt, 'base64'), 32, { N: enc.kdf.N, r: enc.kdf.r, p: enc.kdf.p, maxmem: MAXMEM });
  try { return JSON.parse(open(key, Buffer.from(enc.data, 'base64'), 'plan').toString('utf8')); } catch (e) { throw new Error('PASSWORD_WRONG: The backup password is not correct.'); }
}

// parts: [[name, Buffer | file path]]. Files are streamed in one at a time.
function writePack(file, header, parts) {
  const blobs = {};
  let offset = 0;
  for (const [name, src] of parts) {
    const len = Buffer.isBuffer(src) ? src.length : fs.statSync(src).size;
    blobs[name] = [offset, len];
    offset += len;
  }
  const head = Buffer.from(JSON.stringify({ ...header, blobs }));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(head.length);
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, Buffer.concat([MAGIC, len, head]));
    for (const [, src] of parts) fs.writeSync(fd, Buffer.isBuffer(src) ? src : fs.readFileSync(src));
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function readPack(file) {
  const fd = fs.openSync(file, 'r');
  const read = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b; };
  try {
    const top = read(0, MAGIC.length + 4);
    if (!top.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a Holdfast phone file');
    const hlen = top.readUInt32BE(MAGIC.length);
    const header = JSON.parse(read(MAGIC.length + 4, hlen).toString('utf8'));
    const start = MAGIC.length + 4 + hlen;
    const blobs = {};
    for (const [name, [off, len]] of Object.entries(header.blobs || {})) blobs[name] = read(start + off, len);
    return { header, blobs };
  } finally { fs.closeSync(fd); }
}

// Writes the phone file into a backup folder. Returns its id; the caller saves the base under "phone-<id>".
async function writePhoneCopy(root, { plan, password, vaultDir, appVersion }) {
  const id = crypto.randomBytes(8).toString('hex');
  const parts = [['plan', Buffer.from(JSON.stringify(password ? await encryptPlan(plan, password) : plan))]];
  const hasVault = !!vaultDir && fs.existsSync(path.join(vaultDir, 'vault.json'));
  if (hasVault) {
    parts.push(['vault/vault.json', path.join(vaultDir, 'vault.json')]);
    if (fs.existsSync(path.join(vaultDir, 'index.bin'))) parts.push(['vault/index.bin', path.join(vaultDir, 'index.bin')]);
    const files = path.join(vaultDir, 'files');
    if (fs.existsSync(files)) for (const f of fs.readdirSync(files)) if (f.endsWith('.bin')) parts.push(['vault/files/' + f, path.join(files, f)]);
  }
  const header = { format: 'holdfast-phone', version: 1, id, created: new Date().toISOString(), computer: os.hostname(), appVersion, plan: { encrypted: !!password }, vault: hasVault };
  writePack(path.join(root, PHONE_FILE), header, parts);
  return { id, created: header.created, vault: hasVault, encrypted: !!password };
}

// Changes files the phone saved into a backup folder, newest first. Ones already merged are renamed and left out.
function listChanges(root) {
  let names = [];
  try { names = fs.readdirSync(root); } catch (e) { return []; }
  return names.filter((n) => CHANGES.test(n) && !n.includes(MERGED)).map((n) => {
    const file = path.join(root, n);
    return { file, name: n, modified: fs.statSync(file).mtime.toISOString() };
  }).sort((a, b) => b.modified.localeCompare(a.modified));
}

// Unpacks a changes file into a temporary folder that looks like a backup drive, ready for UsbBackup.preview().
async function unpackChanges(file, password, tmpRoot) {
  const { header, blobs } = readPack(file);
  if (header.format !== 'holdfast-phone-changes') throw new Error('This is not a changes file from the Holdfast phone app');
  let plan = JSON.parse(blobs.plan.toString('utf8'));
  if (plan && plan.format === 'eps-plan-enc') plan = await decryptPlan(plan, password);
  // Named like a backup folder, so it is used as it is rather than looked for inside.
  const root = path.join(tmpRoot, crypto.randomBytes(4).toString('hex'), 'Holdfast Backup');
  const data = path.join(root, 'Data', 'data');
  fs.mkdirSync(data, { recursive: true });
  for (const [k, v] of Object.entries(plan)) fs.writeFileSync(path.join(data, k + '.json'), JSON.stringify(v));
  for (const [name, buf] of Object.entries(blobs)) {
    if (!name.startsWith('vault/')) continue;
    const dest = path.join(root, 'Data', ...name.split('/'));
    if (!dest.startsWith(path.join(root, 'Data', 'vault') + path.sep) || !/^[\w./-]+$/.test(name)) throw new Error('Bad file name in changes file');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  const manifest = { format: 'eps-backup-folder', version: 1, id: 'phone-' + header.from, created: new Date().toISOString(), phone: { file, created: header.created, from: header.from }, complete: true };
  fs.writeFileSync(path.join(root, 'backup.json'), JSON.stringify(manifest, null, 1));
  return root;
}

// After merging, the changes file is renamed so it is not offered again.
function markMerged(file) {
  try { fs.renameSync(file, file.replace(/\.holdfast$/i, MERGED + '.holdfast')); } catch (e) { /* read-only or removed: harmless */ }
}

module.exports = { PHONE_FILE, MAGIC, writePack, readPack, writePhoneCopy, listChanges, unpackChanges, markMerged, encryptPlan, decryptPlan };
