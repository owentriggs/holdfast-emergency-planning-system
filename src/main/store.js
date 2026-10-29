// JSON file store. One file per key under <userData>/data. Main process is the only writer.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        this.cache.set(f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      } catch (e) {
        console.error('Store: could not read', f, e.message);
      }
    }
  }

  file(key) {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Bad store key: ' + key);
    return path.join(this.dir, key + '.json');
  }

  get(key, def) {
    return this.cache.has(key) ? this.cache.get(key) : def;
  }

  all() {
    return Object.fromEntries(this.cache);
  }

  set(key, value) {
    const file = this.file(key);
    this.cache.set(key, value);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
    // Keep one previous copy so a bad write can be recovered by hand.
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
    fs.renameSync(tmp, file);
  }

  replaceAll(obj) {
    for (const [k, v] of Object.entries(obj)) this.set(k, v);
  }
}

module.exports = { Store };
