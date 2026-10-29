// Encrypted document vault.
//
// Layout under <userData>/vault:
//   vault.json      header: KDF parameters and the data key wrapped by the password and by the recovery code
//   index.bin       encrypted JSON list of documents (names, categories, notes, file list)
//   files/<id>.bin  one encrypted blob per stored file
//
// Every blob is AES-256-GCM: "EPV1" | iv (12) | tag (16) | ciphertext, with a per-blob AAD so blobs cannot be swapped.
// The data key is random and only ever held in memory while unlocked. Keys are derived with scrypt.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const MAGIC = Buffer.from('EPV1');
const KDF = { N: 1 << 17, r: 8, p: 1 };
const MAXMEM = 256 * 1024 * 1024;
const MAX_FILE = 250 * 1024 * 1024;
// Crockford base32: no I, L, O or U, so the recovery code is easy to read back.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function seal(key, plain, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}

function open(key, buf, aad) {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('Not a vault file');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(4, 16));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function newRecoveryCode() {
  // 15 random bytes = 120 bits = 24 base32 characters.
  const bytes = crypto.randomBytes(15);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  const out = bits.match(/.{5}/g).map((g) => B32[parseInt(g, 2)]).join('');
  return out.match(/.{4}/g).join('-');
}

const normaliseCode = (s) => String(s || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');

class Vault {
  constructor(dir, emit) {
    this.dir = dir;
    this.filesDir = path.join(dir, 'files');
    this.tempDir = path.join(dir, '..', 'vault-temp');
    this.emit = emit;
    this.key = null;
    this.index = null;
    this.failures = 0;
    this.lockedUntil = 0;
    this.wipeTemp();
  }

  headerPath() { return path.join(this.dir, 'vault.json'); }
  exists() { return fs.existsSync(this.headerPath()); }
  isUnlocked() { return !!this.key; }
  header() { return JSON.parse(fs.readFileSync(this.headerPath(), 'utf8')); }

  status() {
    const st = { exists: this.exists(), unlocked: this.isUnlocked(), waitMs: Math.max(0, this.lockedUntil - Date.now()) };
    if (st.exists) {
      const hd = this.header();
      st.created = hd.created;
      st.passwordChanged = hd.passwordChanged;
    }
    return st;
  }

  async wrap(secret, dek, slot) {
    const salt = crypto.randomBytes(16);
    const kek = await scrypt(secret, salt, 32, { ...KDF, maxmem: MAXMEM });
    return { salt: salt.toString('base64'), box: seal(kek, dek, 'slot:' + slot).toString('base64') };
  }

  async unwrap(secret, s, slot, kdf) {
    const kek = await scrypt(secret, Buffer.from(s.salt, 'base64'), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: MAXMEM });
    return open(kek, Buffer.from(s.box, 'base64'), 'slot:' + slot);
  }

  async create(password) {
    if (this.exists()) throw new Error('A vault already exists');
    if (String(password).length < 8) throw new Error('Use at least 8 characters');
    const dek = crypto.randomBytes(32);
    const code = newRecoveryCode();
    const header = {
      format: 'eps-vault', version: 1, created: new Date().toISOString(),
      kdf: { name: 'scrypt', ...KDF },
      slots: { password: await this.wrap(password, dek, 'password'), recovery: await this.wrap(normaliseCode(code), dek, 'recovery') },
    };
    fs.mkdirSync(this.filesDir, { recursive: true });
    this.key = dek;
    this.index = [];
    this.saveIndex();
    writeAtomic(this.headerPath(), JSON.stringify(header, null, 1));
    this.changed();
    return { recoveryCode: code };
  }

  async unlock(secret, useRecovery = false) {
    const wait = this.lockedUntil - Date.now();
    if (wait > 0) throw new Error(`Too many attempts. Try again in ${Math.ceil(wait / 1000)} s`);
    const hd = this.header();
    const slot = useRecovery ? 'recovery' : 'password';
    try {
      this.key = await this.unwrap(useRecovery ? normaliseCode(secret) : String(secret), hd.slots[slot], slot, hd.kdf);
    } catch (e) {
      this.failures++;
      if (this.failures >= 3) this.lockedUntil = Date.now() + Math.min(60, 2 ** (this.failures - 3) * 5) * 1000;
      throw new Error(useRecovery ? 'Recovery code is not correct' : 'Password is not correct');
    }
    this.failures = 0;
    const idx = path.join(this.dir, 'index.bin');
    this.index = fs.existsSync(idx) ? JSON.parse(open(this.key, fs.readFileSync(idx), 'index').toString('utf8')) : [];
    this.changed();
    return true;
  }

  lock() {
    if (!this.key) return;
    this.key.fill(0);
    this.key = null;
    this.index = null;
    this.wipeTemp();
    this.changed();
  }

  // Set a new password. With the recovery code the old password is not needed. A new recovery code can also be issued.
  async changePassword(newPassword, newRecovery) {
    this.need();
    if (newPassword && String(newPassword).length < 8) throw new Error('Use at least 8 characters');
    const hd = this.header();
    let code = null;
    if (newPassword) {
      hd.slots.password = await this.wrap(String(newPassword), this.key, 'password');
      hd.passwordChanged = new Date().toISOString();
    }
    if (newRecovery) {
      code = newRecoveryCode();
      hd.slots.recovery = await this.wrap(normaliseCode(code), this.key, 'recovery');
    }
    writeAtomic(this.headerPath(), JSON.stringify(hd, null, 1));
    return { recoveryCode: code };
  }

  need() { if (!this.key) throw new Error('Vault is locked'); }
  changed() { this.emit('vault:changed', this.status()); }

  saveIndex() {
    writeAtomic(path.join(this.dir, 'index.bin'), seal(this.key, Buffer.from(JSON.stringify(this.index)), 'index'));
  }

  list() { this.need(); return this.index; }

  // Reads another copy of this vault's index (from a backup drive). Throws if it is a different vault.
  openIndex(buf) {
    this.need();
    return JSON.parse(open(this.key, buf, 'index').toString('utf8'));
  }

  // Replaces the index with a merged one: copies in file blobs that only exist in otherDir, and removes blobs no longer used.
  applyMerged(index, otherDir) {
    this.need();
    const keep = new Set(index.flatMap((it) => it.files.map((f) => f.id)));
    for (const id of keep) {
      const mine = path.join(this.filesDir, id + '.bin');
      const theirs = path.join(otherDir, id + '.bin');
      if (!fs.existsSync(mine)) {
        if (!fs.existsSync(theirs)) throw new Error('A file is missing from the drive: ' + id);
        open(this.key, fs.readFileSync(theirs), 'file:' + id); // checks it decrypts before trusting it
        fs.copyFileSync(theirs, mine);
      }
    }
    for (const it of this.index) for (const f of it.files) if (!keep.has(f.id)) fs.rmSync(path.join(this.filesDir, f.id + '.bin'), { force: true });
    this.index = index;
    this.saveIndex();
    this.changed();
  }

  saveEntry(entry) {
    this.need();
    const fields = ['name', 'category', 'person', 'reference', 'issuer', 'issued', 'expires', 'original', 'notes'];
    let it = this.index.find((x) => x.id === entry.id);
    if (!it) {
      it = { id: crypto.randomBytes(8).toString('hex'), added: new Date().toISOString(), files: [] };
      this.index.push(it);
    }
    for (const f of fields) if (f in entry) it[f] = String(entry[f] ?? '');
    it.updated = new Date().toISOString();
    this.saveIndex();
    this.changed();
    return it;
  }

  removeEntry(id) {
    this.need();
    const it = this.index.find((x) => x.id === id);
    if (!it) return;
    for (const f of it.files) fs.rmSync(path.join(this.filesDir, f.id + '.bin'), { force: true });
    this.index = this.index.filter((x) => x !== it);
    this.saveIndex();
    this.changed();
  }

  // files: [{ name, type, data: Buffer|Uint8Array }]
  addFiles(entryId, files) {
    this.need();
    const it = this.index.find((x) => x.id === entryId);
    if (!it) throw new Error('Document not found');
    const added = [];
    for (const f of files) {
      const data = Buffer.from(f.data);
      if (data.length > MAX_FILE) throw new Error(`${f.name} is larger than 250 MB`);
      const id = crypto.randomBytes(12).toString('hex');
      writeAtomic(path.join(this.filesDir, id + '.bin'), seal(this.key, data, 'file:' + id));
      const rec = { id, name: path.basename(String(f.name || 'file')), type: f.type || mimeFor(f.name), size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), added: new Date().toISOString() };
      it.files.push(rec);
      added.push(rec);
    }
    it.updated = new Date().toISOString();
    this.saveIndex();
    this.changed();
    return added;
  }

  removeFile(entryId, fileId) {
    this.need();
    const it = this.index.find((x) => x.id === entryId);
    if (!it) return;
    it.files = it.files.filter((f) => f.id !== fileId);
    fs.rmSync(path.join(this.filesDir, fileId + '.bin'), { force: true });
    this.saveIndex();
    this.changed();
  }

  findFile(fileId) {
    for (const it of this.index || []) {
      const f = it.files.find((x) => x.id === fileId);
      if (f) return f;
    }
    return null;
  }

  readFile(fileId) {
    this.need();
    const f = this.findFile(fileId);
    if (!f) throw new Error('File not found');
    return { file: f, data: open(this.key, fs.readFileSync(path.join(this.filesDir, f.id + '.bin')), 'file:' + f.id) };
  }

  // vault://file/<id>/<name> while unlocked. The name is only there so viewers show it. Decrypted bytes are served from memory and never cached.
  handle(request) {
    const id = new URL(request.url).pathname.split('/')[1];
    if (!this.key || !/^[0-9a-f]+$/.test(id)) return new Response('locked', { status: 403 });
    try {
      const { file, data } = this.readFile(id);
      return new Response(data, { headers: { 'content-type': file.type || 'application/octet-stream', 'cache-control': 'no-store', 'access-control-allow-origin': 'app://ui' } });
    } catch (e) {
      return new Response('not found', { status: 404 });
    }
  }

  // Temporary decrypted copy for opening in another program. Deleted when the vault locks and at startup.
  tempCopy(fileId) {
    const { file, data } = this.readFile(fileId);
    const dir = path.join(this.tempDir, crypto.randomBytes(4).toString('hex'));
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, file.name);
    fs.writeFileSync(p, data);
    return p;
  }

  wipeTemp() {
    try { fs.rmSync(this.tempDir, { recursive: true, force: true }); } catch (e) { /* a program may still have a file open */ }
  }

  stats() {
    const st = { files: 0, bytes: 0 };
    if (fs.existsSync(this.filesDir)) for (const f of fs.readdirSync(this.filesDir)) { st.files++; st.bytes += fs.statSync(path.join(this.filesDir, f)).size; }
    return st;
  }

  // Copy the encrypted vault folder somewhere else (still encrypted, needs the same password).
  backupTo(target) {
    const dest = path.join(target, `eps-vault-${new Date().toISOString().slice(0, 10)}`);
    fs.cpSync(this.dir, dest, { recursive: true, filter: (src) => !src.endsWith('.tmp') });
    return dest;
  }

  restoreFrom(src) {
    const hd = JSON.parse(fs.readFileSync(path.join(src, 'vault.json'), 'utf8'));
    if (hd.format !== 'eps-vault') throw new Error('Not a vault backup folder');
    this.lock();
    if (this.exists()) fs.renameSync(this.dir, this.dir + '-replaced-' + Date.now());
    fs.cpSync(src, this.dir, { recursive: true });
    this.changed();
  }

  destroy() {
    this.lock();
    fs.rmSync(this.dir, { recursive: true, force: true });
    this.changed();
  }
}

const MIMES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', txt: 'text/plain', csv: 'text/csv', md: 'text/plain', json: 'application/json', heic: 'image/heic', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
function mimeFor(name) { return MIMES[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream'; }

module.exports = { Vault, mimeFor, seal, open, scrypt, KDF, MAXMEM };
