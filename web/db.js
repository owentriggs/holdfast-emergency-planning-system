// IndexedDB for the phone app. Stores:
//   plan    one record per plan key, as the computer keeps one JSON file per key
//   vault   "header" (vault.json) and "index" (the encrypted index.bin)
//   files   encrypted vault files by id, exactly as the computer stores them
//   meta    "copy": where this phone's data came from (see api.js)
const NAME = 'holdfast';
const STORES = ['plan', 'vault', 'files', 'meta'];

const ready = new Promise((resolve, reject) => {
  const req = indexedDB.open(NAME, 1);
  req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

async function tx(store, mode, fn) {
  const db = await ready;
  const t = db.transaction(store, mode);
  const out = fn(t.objectStore(store));
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || new Error('Storage aborted (is the phone full?)')); });
  return out instanceof IDBRequest ? out.result : out;
}

export const get = (store, key) => tx(store, 'readonly', (s) => s.get(key));
export const put = (store, key, value) => tx(store, 'readwrite', (s) => { s.put(value, key); });
export const del = (store, key) => tx(store, 'readwrite', (s) => { s.delete(key); });
export const keys = (store) => tx(store, 'readonly', (s) => s.getAllKeys());

export async function all(store) {
  const db = await ready;
  const s = db.transaction(store).objectStore(store);
  const [k, v] = await Promise.all([done(s.getAllKeys()), done(s.getAll())]);
  return Object.fromEntries(k.map((key, i) => [key, v[i]]));
}

// Replaces everything in the given stores in one go, so a half-finished import never leaves a mix of old and new.
export async function replace(contents) {
  const db = await ready;
  const names = Object.keys(contents);
  const t = db.transaction(names, 'readwrite');
  for (const name of names) {
    const s = t.objectStore(name);
    s.clear();
    for (const [k, v] of Object.entries(contents[name])) s.put(v, k);
  }
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || new Error('Storage aborted (is the phone full?)')); });
}
