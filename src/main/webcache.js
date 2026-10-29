// Offline web page cache. Pages are saved as MHTML (single file, opens offline in Chromium).
// PDFs and other documents are saved as the raw file.
const { BrowserWindow, net } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY = 'webcache';
const UA_SUFFIX = ' Holdfast/0.2';

class WebCache {
  constructor(store, dir, emit) {
    this.store = store;
    this.dir = dir;
    this.emit = emit; // (channel, payload) to renderer
    this.busy = false;
    this.cancelled = false;
    fs.mkdirSync(dir, { recursive: true });
  }

  list() {
    return this.store.get(KEY, []);
  }

  save(list) {
    this.store.set(KEY, list);
    this.emit('store:changed', { key: KEY, value: list });
  }

  newId() {
    return crypto.randomBytes(6).toString('hex');
  }

  add(entries) {
    const list = this.list();
    const added = [];
    for (const e of entries) {
      const url = normaliseUrl(e.url);
      if (!url) continue;
      if (list.some((x) => x.url === url)) continue;
      const item = {
        id: this.newId(),
        url,
        title: e.title || url,
        group: e.group || 'General',
        notes: e.notes || '',
        parentId: e.parentId || null,
        addedAt: new Date().toISOString(),
        lastCaptured: null,
        lastAttempt: null,
        status: 'not captured',
        changed: false,
        type: null,
        size: 0,
        hash: null,
        file: null,
        versions: [],
      };
      list.push(item);
      added.push(item);
    }
    this.save(list);
    return added;
  }

  update(id, patch) {
    const list = this.list();
    const it = list.find((x) => x.id === id);
    if (!it) return null;
    for (const k of ['title', 'group', 'notes', 'url']) if (k in patch) it[k] = patch[k];
    if ('changed' in patch) it.changed = !!patch.changed;
    this.save(list);
    return it;
  }

  remove(ids) {
    const list = this.list();
    const keep = [];
    for (const it of list) {
      if (ids.includes(it.id)) {
        fs.rmSync(path.join(this.dir, it.id), { recursive: true, force: true });
      } else keep.push(it);
    }
    this.save(keep);
  }

  filePath(it, file) {
    return path.join(this.dir, it.id, file || it.file);
  }

  stats() {
    let bytes = 0;
    for (const it of this.list()) for (const v of it.versions || []) bytes += v.size || 0;
    return { pages: this.list().length, bytes };
  }

  cancel() {
    this.cancelled = true;
  }

  // Capture (or re-capture) the given ids. opts: { keepVersions, linked: { maxPages } }
  async capture(ids, opts = {}) {
    if (this.busy) throw new Error('A capture is already running');
    this.busy = true;
    this.cancelled = false;
    const keep = Math.max(1, opts.keepVersions || 3);
    const results = [];
    try {
      let queue = [...ids];
      let done = 0;
      while (queue.length) {
        if (this.cancelled) break;
        const id = queue.shift();
        const it = this.list().find((x) => x.id === id);
        if (!it) continue;
        this.emit('webcache:progress', { id, url: it.url, done, total: done + queue.length + 1, state: 'capturing' });
        let res;
        try {
          res = await this.captureOne(it, keep);
          if (opts.linked && res.links && res.links.length) {
            const max = opts.linked.maxPages || 10;
            const children = this.add(
              res.links.slice(0, max).map((l) => ({ url: l.url, title: l.text, group: it.group, parentId: it.id }))
            );
            queue.push(...children.map((c) => c.id));
          }
        } catch (e) {
          res = { ok: false, error: e.message };
          const list = this.list();
          const cur = list.find((x) => x.id === id);
          if (cur) {
            cur.lastAttempt = new Date().toISOString();
            cur.status = 'error: ' + e.message;
            this.save(list);
          }
        }
        results.push({ id, ...res, links: undefined });
        done++;
        this.emit('webcache:progress', { id, url: it.url, done, total: done + queue.length, state: res.ok ? 'ok' : 'error', error: res.error });
      }
    } finally {
      this.busy = false;
      this.emit('webcache:progress', { state: 'finished' });
    }
    return results;
  }

  async captureOne(it, keep) {
    const dir = path.join(this.dir, it.id);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const kind = await sniffType(it.url);
    let file, title, hash, links = [];

    if (kind.isDocument) {
      const res = await net.fetch(it.url, { headers: { 'User-Agent': 'Mozilla/5.0' + UA_SUFFIX } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      file = `${stamp}.${kind.ext}`;
      fs.writeFileSync(path.join(dir, file), buf);
      hash = sha(buf);
      title = it.title && it.title !== it.url ? it.title : decodeURIComponent(it.url.split('/').pop() || it.url);
    } else {
      const page = await this.renderAndSave(it.url, path.join(dir, `${stamp}.mhtml`));
      file = `${stamp}.mhtml`;
      title = page.title;
      hash = sha(page.text);
      links = page.links;
    }

    const size = fs.statSync(path.join(dir, file)).size;
    const list = this.list();
    const cur = list.find((x) => x.id === it.id);
    const prevHash = cur.hash;
    cur.versions = [{ at: new Date().toISOString(), file, size, hash }, ...(cur.versions || [])];
    for (const old of cur.versions.slice(keep)) fs.rmSync(path.join(dir, old.file), { force: true });
    cur.versions = cur.versions.slice(0, keep);
    cur.file = file;
    cur.type = kind.isDocument ? kind.ext : 'mhtml';
    cur.size = size;
    cur.changed = !!prevHash && prevHash !== hash;
    cur.hash = hash;
    if (!cur.title || cur.title === cur.url) cur.title = title || cur.url;
    cur.lastCaptured = cur.lastAttempt = new Date().toISOString();
    cur.status = 'ok';
    this.save(list);
    return { ok: true, changed: cur.changed, links };
  }

  async renderAndSave(url, outFile) {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { partition: 'persist:capture', javascript: true, images: true, backgroundThrottling: false },
    });
    try {
      win.webContents.setUserAgent(win.webContents.getUserAgent() + UA_SUFFIX);
      win.webContents.setAudioMuted(true);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      await withTimeout(win.loadURL(url), 45000, 'Page load timed out');
      // Let late content settle, then scroll so lazy images load.
      await delay(1200);
      await win.webContents.executeJavaScript(`(async () => {
        const h = document.body ? document.body.scrollHeight : 0;
        for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
        window.scrollTo(0, 0);
        document.querySelectorAll('img[loading=lazy]').forEach(i => i.loading = 'eager');
      })()`);
      await delay(800);
      // Remove cookie banners and similar overlays so the saved copy is readable.
      const info = await win.webContents.executeJavaScript(`(() => {
        const sel = '[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[aria-label*=cookie i]';
        document.querySelectorAll(sel).forEach(el => {
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed' || cs.position === 'sticky' || el.getAttribute('role') === 'dialog' || el.tagName === 'DIALOG' || /banner|message|notice/i.test(el.className + el.id)) el.remove();
        });
        const host = location.host;
        const seen = new Set();
        const links = [];
        document.querySelectorAll('main a[href], article a[href], #content a[href], a[href]').forEach(a => {
          try {
            const u = new URL(a.href);
            if (u.host !== host || !/^https?:$/.test(u.protocol)) return;
            u.hash = '';
            const s = u.toString();
            if (seen.has(s) || s === location.href) return;
            if (/\\.(jpg|jpeg|png|gif|svg|zip|mp4|mp3)$/i.test(u.pathname)) return;
            seen.add(s);
            links.push({ url: s, text: (a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120) });
          } catch (e) {}
        });
        return { title: document.title, text: document.body ? document.body.innerText : '', links };
      })()`);
      await win.webContents.savePage(outFile, 'MHTML');
      return info;
    } finally {
      win.destroy();
    }
  }
}

async function sniffType(url) {
  const ext = (new URL(url).pathname.split('.').pop() || '').toLowerCase();
  const docExt = ['pdf', 'txt', 'csv', 'docx', 'doc', 'xlsx', 'odt'];
  if (docExt.includes(ext)) return { isDocument: true, ext };
  try {
    const res = await withTimeout(net.fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' + UA_SUFFIX } }), 10000, 'HEAD timeout');
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/pdf')) return { isDocument: true, ext: 'pdf' };
  } catch (e) {
    // HEAD is not supported everywhere; fall back to rendering.
  }
  return { isDocument: false };
}

function normaliseUrl(u) {
  try {
    const url = new URL(String(u).trim().match(/^https?:\/\//i) ? String(u).trim() : 'https://' + String(u).trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch (e) {
    return null;
  }
}

const sha = (data) => crypto.createHash('sha1').update(data).digest('hex');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej(new Error(msg)), ms)))]).finally(() => clearTimeout(t));
}

module.exports = { WebCache };
