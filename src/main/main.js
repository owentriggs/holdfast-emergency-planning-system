const { app, BrowserWindow, ipcMain, protocol, net, dialog, shell, Menu, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Store } = require('./store');
const { WebCache } = require('./webcache');
const { Tiles } = require('./tiles');
const { Vault } = require('./vault');
const { UsbBackup, PORTABLE, LEGACY, backupRoot } = require('./backup');

// A copy of the program made by "USB Backup" carries holdfast-portable.json (eps-portable.json before the rename)
// and keeps its data on the same drive.
// Chromium's own cache stays on the computer so the drive only holds the user's data.
if (app.isPackaged) {
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  try {
    const file = [PORTABLE, LEGACY.portable].map((f) => path.join(exeDir, f)).find((f) => fs.existsSync(f));
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    app.setPath('userData', path.resolve(exeDir, cfg.dataDir));
    app.setPath('sessionData', path.join(app.getPath('temp'), 'holdfast-portable-session'));
  } catch (e) { /* normal install */ }
}

// The app was called "Emergency Planning System" before it became Holdfast. On first run after the rename, move the
// data folder across. Only for the default location (not portable copies or tests that set their own folder). If the
// old folder cannot be moved (for example the old version is still open), keep using it where it is.
{
  const now = app.getPath('userData');
  const old = path.join(app.getPath('appData'), 'Emergency Planning System');
  if (now === path.join(app.getPath('appData'), app.getName()) && now !== old && !fs.existsSync(path.join(now, 'data')) && fs.existsSync(path.join(old, 'data'))) {
    try {
      if (fs.existsSync(now)) fs.rmdirSync(now); // only succeeds if empty
      fs.renameSync(old, now);
    } catch (e) {
      app.setPath('userData', old);
    }
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'tile', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const ASSETS = path.join(ROOT, 'src', 'assets');
const LIBS = {
  leaflet: path.join(ROOT, 'node_modules', 'leaflet', 'dist'),
  chartjs: path.join(ROOT, 'node_modules', 'chart.js', 'dist'),
  mdi: path.join(ROOT, 'node_modules', '@mdi', 'font'),
};
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject' };

let win, store, webcache, tiles, vault, usb;
const emit = (ch, payload) => win && !win.isDestroyed() && win.webContents.send(ch, payload);
const settings = () => store.get('settings', {});

function serveApp(request) {
  const u = new URL(request.url);
  const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
  let base = RENDERER;
  if (u.host === 'lib') base = LIBS[parts.shift()];
  else if (u.host === 'assets') base = ASSETS;
  if (!base) return new Response('not found', { status: 404 });
  const file = path.normalize(path.join(base, ...parts));
  if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('not found', { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
}

function createWindow() {
  const st = settings();
  win = new BrowserWindow({
    width: st.winW || 1440,
    height: st.winH || 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Holdfast Emergency Planning System',
    icon: path.join(ASSETS, 'icon.ico'),
    backgroundColor: '#f3f3f3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: true,
    },
  });
  win.loadURL('app://ui/index.html');
  win.on('close', () => {
    const [w, h] = win.getSize();
    store.set('settings', { ...settings(), winW: w, winH: h });
  });
  // Links clicked in the app open in the system browser, never in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
}

// Guests (<webview> in the offline viewer) may not open new windows.
app.on('web-contents-created', (_e, wc) => {
  if (wc.getType() !== 'webview') return;
  wc.setWindowOpenHandler(({ url }) => {
    emit('viewer:open-request', url);
    return { action: 'deny' };
  });
  // Links clicked inside a cached copy are routed back to the app, which opens the cached copy if there is one.
  wc.on('will-navigate', (e, url) => {
    if (wc.getURL().startsWith('file:') && /^https?:/.test(url)) {
      e.preventDefault();
      emit('viewer:open-request', url);
    }
  });
});

app.setAppUserModelId('uk.local.emergencyplanner');

app.whenReady().then(() => {
  const dataRoot = path.join(app.getPath('userData'));
  store = new Store(path.join(dataRoot, 'data'));
  webcache = new WebCache(store, path.join(dataRoot, 'webcache'), emit);
  tiles = new Tiles(path.join(dataRoot, 'tiles'), settings, emit);
  vault = new Vault(path.join(dataRoot, 'vault'), emit);
  usb = new UsbBackup(app, dataRoot, store, emit, vault);

  // Watch for backup drives that were edited on another computer (by the program copy on the drive).
  let lastSync = '[]';
  setInterval(async () => {
    try {
      const found = JSON.stringify(await usb.scan());
      if (found !== lastSync) emit('usb:sync-status', JSON.parse((lastSync = found)));
    } catch (e) { console.error('usb scan', e); }
  }, 5000);
  // Backup drives being plugged in or removed, for the sidebar.
  let lastPresent = '[]';
  setInterval(() => {
    try {
      const found = JSON.stringify(usb.present());
      if (found !== lastPresent) emit('usb:present', JSON.parse((lastPresent = found)));
    } catch (e) { console.error('usb present', e); }
  }, 2000);

  protocol.handle('app', serveApp);
  protocol.handle('tile', (req) => tiles.handle(req));
  protocol.handle('vault', (req) => vault.handle(req));

  // Lock the vault when Windows locks or sleeps, or after the computer has been idle for the set time.
  powerMonitor.on('lock-screen', () => vault.lock());
  powerMonitor.on('suspend', () => vault.lock());
  setInterval(() => {
    const mins = Number(settings().vaultAutoLock ?? 5);
    if (vault.isUnlocked() && mins > 0 && powerMonitor.getSystemIdleTime() >= mins * 60) vault.lock();
  }, 15000);

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'File', submenu: [{ label: 'Print centre', accelerator: 'Ctrl+P', click: () => emit('nav', 'print') }, { type: 'separator' }, { role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    ])
  );

  registerIpc(dataRoot);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => vault && vault.lock());

// Loads HTML into a hidden window (scripts off) and runs fn with it.
async function withHtmlWindow(html, fn) {
  const tmp = path.join(app.getPath('temp'), `eps-print-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const pw = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  try {
    await pw.loadFile(tmp);
    return await fn(pw);
  } finally {
    pw.destroy();
    fs.rmSync(tmp, { force: true });
  }
}

const PDF_FOOTER = '<div style="font-size:7pt;width:100%;text-align:center;color:#555">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>';
const pdfOnce = (html) => withHtmlWindow(html, (pw) => pw.webContents.printToPDF({ pageSize: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: PDF_FOOTER, margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } }));

// Page number of each named destination (an element id a link points at) in a PDF from printToPDF.
function pdfDestPages(pdf) {
  const text = pdf.toString('latin1');
  const obj = (n) => (text.match(new RegExp(`(?:^|\\s)${n} 0 obj\\s([\\s\\S]*?)endobj`)) || [])[1] || '';
  const pages = [];
  const walk = (n) => {
    const kids = obj(n).match(/\/Kids\s*\[([^\]]*)\]/);
    if (kids) for (const m of kids[1].matchAll(/(\d+) 0 R/g)) walk(m[1]);
    else pages.push(n);
  };
  const root = text.match(/\/Pages (\d+) 0 R/);
  const dests = text.match(/\/Dests (\d+) 0 R/);
  if (!root || !dests) return {};
  walk(root[1]);
  const out = {};
  for (const m of obj(dests[1]).matchAll(/\/([^\s[\/]+)\s*\[\s*(\d+) 0 R/g)) {
    const name = m[1].replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    out[name] = pages.indexOf(m[2]) + 1;
  }
  return out;
}

// Fills in the contents page numbers (<!--pg:id-->...<!--/pg-->) from a first layout pass.
async function withPageNumbers(html) {
  if (!html.includes('<!--pg:')) return html;
  const pages = pdfDestPages(await pdfOnce(html));
  return html.replace(/<!--pg:([^>]*?)-->[\s\S]*?<!--\/pg-->/g, (_, id) => pages[id] || '');
}

const renderPdf = async (html) => pdfOnce(await withPageNumbers(html));

function registerIpc(dataRoot) {
  ipcMain.handle('store:all', () => store.all());
  ipcMain.handle('store:set', (_e, key, value) => {
    if (key === 'webcache') throw new Error('webcache is managed by the main process');
    store.set(key, value);
    return true;
  });

  ipcMain.handle('net:get', async (_e, url, as = 'json') => {
    if (!/^https:\/\//.test(url)) throw new Error('Only https URLs are allowed');
    const res = await net.fetch(url, { headers: { 'User-Agent': 'Holdfast/0.2', Accept: as === 'json' ? 'application/json' : '*/*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return as === 'json' ? res.json() : res.text();
  });

  // Web cache
  ipcMain.handle('webcache:add', (_e, entries) => webcache.add(entries));
  ipcMain.handle('webcache:update', (_e, id, patch) => webcache.update(id, patch));
  ipcMain.handle('webcache:remove', (_e, ids) => webcache.remove(ids));
  ipcMain.handle('webcache:capture', (_e, ids, opts) => webcache.capture(ids, { keepVersions: settings().keepVersions || 3, ...opts }));
  ipcMain.handle('webcache:cancel', () => webcache.cancel());
  ipcMain.handle('webcache:stats', () => webcache.stats());
  ipcMain.handle('webcache:fileUrl', (_e, id, file) => {
    const it = webcache.list().find((x) => x.id === id);
    if (!it || !(file || it.file)) return null;
    return pathToFileURL(webcache.filePath(it, file)).toString();
  });
  ipcMain.handle('webcache:openFolder', (_e, id) => shell.openPath(id ? path.join(dataRoot, 'webcache', id) : path.join(dataRoot, 'webcache')));

  // Tiles
  ipcMain.handle('tiles:sources', () => tiles.sources());
  ipcMain.handle('tiles:estimate', (_e, b, z1, z2) => tiles.estimate(b, z1, z2));
  ipcMain.handle('tiles:download', (_e, src, b, z1, z2) => tiles.downloadArea(src, b, z1, z2));
  ipcMain.handle('tiles:cancel', () => tiles.cancel());
  ipcMain.handle('tiles:stats', () => tiles.stats());
  ipcMain.handle('tiles:clear', (_e, src) => tiles.clear(src));

  // Document vault
  ipcMain.handle('vault:status', () => vault.status());
  ipcMain.handle('vault:create', (_e, pw) => vault.create(pw));
  ipcMain.handle('vault:unlock', (_e, secret, useRecovery) => vault.unlock(secret, useRecovery));
  ipcMain.handle('vault:lock', () => vault.lock());
  ipcMain.handle('vault:changePassword', (_e, pw, newRecovery) => vault.changePassword(pw, newRecovery));
  ipcMain.handle('vault:list', () => vault.list());
  ipcMain.handle('vault:saveEntry', (_e, entry) => vault.saveEntry(entry));
  ipcMain.handle('vault:removeEntry', (_e, id) => vault.removeEntry(id));
  ipcMain.handle('vault:addFiles', (_e, id, files) => vault.addFiles(id, files));
  ipcMain.handle('vault:pickFiles', async (_e, id) => {
    const r = await dialog.showOpenDialog(win, { title: 'Add files to the vault', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Documents and images', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'txt', 'csv', 'doc', 'docx', 'xlsx'] }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled) return [];
    return vault.addFiles(id, r.filePaths.map((p) => ({ name: path.basename(p), data: fs.readFileSync(p) })));
  });
  ipcMain.handle('vault:removeFile', (_e, id, fileId) => vault.removeFile(id, fileId));
  ipcMain.handle('vault:saveCopy', async (_e, fileId) => {
    const { file, data } = vault.readFile(fileId);
    const r = await dialog.showSaveDialog(win, { title: 'Save decrypted copy', defaultPath: file.name });
    if (r.canceled) return { ok: false };
    fs.writeFileSync(r.filePath, data);
    return { ok: true, path: r.filePath };
  });
  ipcMain.handle('vault:openExternal', async (_e, fileId) => {
    const err = await shell.openPath(vault.tempCopy(fileId));
    if (err) throw new Error(err);
    return true;
  });
  ipcMain.handle('vault:stats', () => vault.stats());
  ipcMain.handle('vault:backup', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose where to save the encrypted vault backup', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return { ok: false };
    return { ok: true, path: vault.backupTo(r.filePaths[0]) };
  });
  ipcMain.handle('vault:restore', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a vault backup folder (contains vault.json)', properties: ['openDirectory'] });
    if (r.canceled) return { ok: false };
    vault.restoreFrom(r.filePaths[0]);
    return { ok: true };
  });
  ipcMain.handle('vault:destroy', () => vault.destroy());

  // Printing: render supplied HTML in a hidden window, then print or save as PDF.
  ipcMain.handle('print:html', async (_e, html, mode = 'print') => {
    if (mode === 'pdf') {
      const r = await dialog.showSaveDialog(win, { title: 'Save as PDF', defaultPath: `Emergency plan ${new Date().toISOString().slice(0, 10)}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (r.canceled) return { ok: false };
      fs.writeFileSync(r.filePath, await renderPdf(html));
      shell.openPath(r.filePath);
      return { ok: true, path: r.filePath };
    }
    return withHtmlWindow(await withPageNumbers(html), (pw) => new Promise((resolve) => pw.webContents.print({ printBackground: true, footer: 'Holdfast Emergency Plan' }, (ok, reason) => resolve({ ok, reason }))));
  });

  // USB / external drive backup
  ipcMain.handle('usb:drives', () => usb.drives());
  ipcMain.handle('usb:estimate', () => usb.estimate());
  ipcMain.handle('usb:chooseFolder', async (_e, title) => {
    const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return null;
    const p = r.filePaths[0];
    return { path: p, manifest: usb.readManifest(backupRoot(p)) };
  });
  // Eject is refused while a backup, restore or sync is writing to a drive.
  let usbWriting = 0;
  const writing = (fn) => async (...a) => { usbWriting++; try { return await fn(...a); } finally { usbWriting--; } };
  ipcMain.handle('usb:run', writing(async (_e, target, opts) => {
    if (path.resolve(backupRoot(target), 'Data').toLowerCase() === path.resolve(dataRoot).toLowerCase()) throw new Error('The app is running from this backup. Choose a different drive.');
    const pdf = opts.pdfHtml ? await renderPdf(opts.pdfHtml) : null;
    const r = await usb.run(target, { ...opts, pdf });
    store.set('settings', { ...settings(), lastUsbBackup: r.manifest.created, lastUsbTarget: target });
    emit('store:changed', { key: 'settings', value: settings() });
    return r;
  }));
  ipcMain.handle('usb:restore', writing((_e, folder, opts) => usb.restore(folder, opts, vault)));
  ipcMain.handle('usb:preview', async (_e, target, choices) => {
    const { plan, vault: v, ...p } = await usb.preview(target, choices);
    return { ...p, vault: { state: v.state, changed: v.changed } };
  });
  ipcMain.handle('usb:apply', writing((_e, target, choices) => usb.apply(target, choices)));
  ipcMain.handle('usb:syncStatus', () => usb.scan());
  ipcMain.handle('usb:present', () => usb.present());
  ipcMain.handle('usb:cancel', () => usb.cancel());
  ipcMain.handle('usb:eject', (_e, id) => {
    if (usbWriting) throw new Error('A backup is still being written. Wait for it to finish, then eject.');
    return usb.eject(id);
  });
  ipcMain.handle('usb:openFolder', (_e, p) => shell.openPath(fs.existsSync(backupRoot(p)) ? backupRoot(p) : p));

  // Backup
  ipcMain.handle('backup:export', async () => {
    const r = await dialog.showSaveDialog(win, { title: 'Export backup', defaultPath: `holdfast-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return { ok: false };
    fs.writeFileSync(r.filePath, JSON.stringify({ format: 'eps-backup', version: 1, exportedAt: new Date().toISOString(), data: store.all() }, null, 1));
    return { ok: true, path: r.filePath };
  });
  ipcMain.handle('backup:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Import backup', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled) return { ok: false };
    const obj = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (obj.format !== 'eps-backup' || !obj.data) throw new Error('Not a Holdfast backup file');
    store.replaceAll(obj.data);
    return { ok: true };
  });
  ipcMain.handle('app:openDataFolder', () => shell.openPath(dataRoot));
  ipcMain.handle('app:openExternal', (_e, url) => /^https?:/.test(url) && shell.openExternal(url));
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataRoot }));
}
