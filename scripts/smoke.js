// Smoke test: starts the app with a throwaway data folder, opens every page, saves a screenshot of each
// and reports console errors. Usage: npx electron scripts/smoke.js <outDir>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'eps-smoke'));
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'eps-data-')));
require('../src/main/main.js');

const PAGES = ['dashboard', 'planner', 'contacts', 'supplies', 'checklists', 'firstaid', 'library', 'radio', 'maps', 'weather', 'tools', 'print', 'settings'];
const errors = [];

app.on('browser-window-created', (_e, win) => {
  if (win.getTitle() !== 'Emergency Planning System' && BrowserWindow.getAllWindows().length > 1) return;
  win.webContents.on('console-message', (_ev, level, message, line, source) => {
    if (level >= 2) errors.push(`[${level === 3 ? 'error' : 'warn'}] ${message} (${source}:${line})`);
  });
  win.webContents.once('did-finish-load', async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(1500);
    for (const p of PAGES) {
      await win.webContents.executeJavaScript(`window.go(${JSON.stringify(p)})`);
      await wait(p === 'maps' || p === 'weather' ? 3000 : 900);
      const err = await win.webContents.executeJavaScript(`(document.querySelector('#page .note.warn') || {}).textContent || ''`);
      if (/Error loading page/.test(err)) errors.push(`[page ${p}] ${err}`);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(out, `${p}.png`), img.toPNG());
    }
    if (process.env.EPS_DEEP) {
      const js = (code) => win.webContents.executeJavaScript(code);
      const shot = async (name) => fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
      // Seed a household so location-based pages have data.
      await js(`(async () => { const s = await import('./lib/store.js'); const hh = s.get('household');
        Object.assign(hh, { name: 'Test household', postcode: 'CF10 1EP', address: '1 Test Street\\nCardiff', lat: 51.4816, lon: -3.1791 });
        hh.people.push({ id: 'p1', name: 'Alex', dob: '1985-03-02', mobile: '07700 900000', conditions: 'Asthma', allergies: 'Penicillin' }, { id: 'p2', name: 'Sam', dob: '2015-06-10' });
        s.save('household'); })()`);
      // Web capture end to end.
      const res = await js(`(async () => { const a = await window.api.webcache.add([{ url: 'https://beready.campaign.gov.uk/be-ready-for-emergencies/', group: 'UK Government' }]); return window.api.webcache.capture(a.map(x => x.id)); })()`);
      console.log('CAPTURE', JSON.stringify(res));
      await js(`window.go('library')`);
      await wait(1000);
      await shot('deep-library');
      await js(`document.querySelector('#page tbody a').click()`);
      await wait(4000);
      await shot('deep-viewer');
      await js(`window.go('weather')`);
      await wait(6000);
      await shot('deep-weather');
      await js(`window.go('maps')`);
      await wait(5000);
      await shot('deep-maps');
      await js(`window.go('dashboard')`);
      await wait(1500);
      await shot('deep-dashboard');
      const html = await js(`import('./lib/printdoc.js').then(m => m.buildDocument(m.SECTIONS.map(s => s.id), { pageBreaks: true }))`);
      const tmp = path.join(out, 'plan.html');
      fs.writeFileSync(tmp, html);
      const pw = new BrowserWindow({ show: false });
      await pw.loadFile(tmp);
      fs.writeFileSync(path.join(out, 'plan.pdf'), await pw.webContents.printToPDF({ pageSize: 'A4', printBackground: true }));
      pw.destroy();
    }
    fs.writeFileSync(path.join(out, 'errors.txt'), errors.join('\n') || 'none');
    console.log('SMOKE DONE', out, '\n' + (errors.join('\n') || 'no errors'));
    app.exit(0);
  });
});
