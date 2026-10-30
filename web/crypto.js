// The vault's encryption, done with the browser's own crypto so files stay readable by the computer (src/main/vault.js):
// AES-256-GCM blobs "EPV1" | iv (12) | tag (16) | ciphertext with a per-blob AAD, keys from scrypt.
// scrypt comes from scrypt-js (lib/scrypt/scrypt.js, loaded as a plain script); browsers have no scrypt of their own.
const MAGIC = new TextEncoder().encode('EPV1');
export const KDF = { N: 1 << 17, r: 8, p: 1 };

const utf8 = (s) => new TextEncoder().encode(s);
export const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function scrypt(secret, salt, kdf = KDF) {
  return window.scrypt.scrypt(utf8(String(secret)), salt, kdf.N, kdf.r, kdf.p, 32);
}

const aesKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function seal(raw, plain, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, await aesKey(raw), plain));
  // Web Crypto puts the tag after the ciphertext; the vault format puts it before.
  const ct = out.subarray(0, out.length - 16);
  const tag = out.subarray(out.length - 16);
  const buf = new Uint8Array(32 + ct.length);
  buf.set(MAGIC, 0); buf.set(iv, 4); buf.set(tag, 16); buf.set(ct, 32);
  return buf;
}

export async function open(raw, buf, aad) {
  buf = new Uint8Array(buf);
  if (!MAGIC.every((b, i) => buf[i] === b)) throw new Error('Not a vault file');
  const joined = new Uint8Array(buf.length - 16);
  joined.set(buf.subarray(32), 0);
  joined.set(buf.subarray(16, 32), buf.length - 32);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(4, 16), additionalData: utf8(aad) }, await aesKey(raw), joined));
}

export const normaliseCode = (s) => String(s || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');

// Plan data protected with the backup password, as plan.epsenc on a backup drive.
export async function encryptPlan(plan, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await scrypt(password, salt);
  return { format: 'eps-plan-enc', version: 1, kdf: { ...KDF, salt: b64(salt) }, data: b64(await seal(key, utf8(JSON.stringify(plan)), 'plan')) };
}

export async function decryptPlan(enc, password) {
  const key = await scrypt(password, unb64(enc.kdf.salt), enc.kdf);
  try { return JSON.parse(new TextDecoder().decode(await open(key, unb64(enc.data), 'plan'))); } catch (e) { throw new Error('PASSWORD_WRONG'); }
}

export async function sha256(u8) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', u8))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
