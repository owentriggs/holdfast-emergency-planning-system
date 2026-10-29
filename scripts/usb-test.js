// Checks parent / carer details on wallet cards, and USB backup and restore into a temp folder.
// Usage: npx electron scripts/usb-test.js   (screenshots go to EPS_SHOTS or the temp data folder)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eps-usb-'));
const target = fs.mkdtempSync(path.join(os.tmpdir(), 'eps-usb-target-'));
const shots = process.env.EPS_SHOTS || dataDir;
app.setPath('userData', dataDir);
fs.mkdirSync(path.join(dataDir, 'data'), { recursive: true });
const w = (k, v) => fs.writeFileSync(path.join(dataDir, 'data', k + '.json'), JSON.stringify(v));
w('settings', { dataVersion: 2 });
w('household', { name: 'Jones household', address: '4 Station Road\nCardiff', postcode: 'CF10 1AA', people: [
  { id: 'mum', name: 'Sarah Jones', role: 'Parent / carer', mobile: '07700 900111', dob: '1985-03-02' },
  { id: 'kid', name: 'Tom Jones', role: 'Child', dob: '2017-06-10', carer1: 'p:mum', carer2: 'c:gran', allergies: 'Peanuts', blood: 'O+' },
], pets: [] });
w('contacts', [{ id: 'gran', name: 'Mary Evans', relation: 'Grandmother', phone: '07700 900222', category: 'Family', ice: true }]);
require('../src/main/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra = '') => results.push(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ' (' + extra + ')' : ''}`);

app.on('browser-window-created', (_e, win) => {
  if (win.id !== 1) return;
  win.webContents.on('console-message', (_ev, level, message) => level >= 2 && console.log('console:', message));
  win.webContents.once('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c);
    const shot = async (name, wc = win.webContents) => fs.writeFileSync(path.join(shots, name), (await wc.capturePage()).toPNG());
    try {
      await wait(1200);
      // Cards
      const html = await js(`import('app://ui/lib/printdoc.js').then((m) => m.buildDocument(['cards']))`);
      const cards = html.split('class="card"').slice(1);
      const tom = cards.find((c) => c.includes('EMERGENCY CARD: Tom')) || '';
      const sarah = cards.find((c) => c.includes('EMERGENCY CARD: Sarah')) || '';
      check('Child card shows parent and phone', tom.includes('contact my parent / carer') && tom.includes('Sarah Jones') && tom.includes('07700 900111'));
      check('Child card shows contact carer', tom.includes('Mary Evans') && tom.includes('Grandmother') && tom.includes('07700 900222'));
      check('Child card shows allergy and blood', tom.includes('Peanuts') && tom.includes('Blood O+'));
      check('Gran not repeated as ICE on child card', tom.split('Mary Evans').length === 2);
      check('Parent card lists who they care for', sarah.includes('I care for:') && sarah.includes('Tom Jones'));
      const pw = new BrowserWindow({ show: false, width: 900, height: 700 });
      await pw.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
      await wait(300);
      await shot('cards.png', pw.webContents);
      pw.destroy();

      await js(`window.go('planner')`);
      await wait(600);
      check('Planner has role and carer columns', await js(`(() => { const t = document.querySelector('.tbl.edit thead').innerText; return t.includes('Role') && t.includes('Parent / carer'); })()`));
      await shot('planner-people.png');

      // USB backup
      await js(`window.api.vault.create('vault password 1')`);
      await js(`window.go('usb')`);
      await wait(1500);
      await shot('usb-page.png');
      check('Drive list loads', await js(`window.api.usb.drives().then((d) => Array.isArray(d), () => false)`));
      const pdfHtml = await js(`import('app://ui/lib/printdoc.js').then((m) => m.buildDocument(m.SECTIONS.map((s) => s.id)))`);
      const r1 = await js(`window.api.usb.run(${JSON.stringify(target)}, { plan: true, password: 'backup pass 1', vault: true, library: true, tiles: false, app: false, pdfHtml: ${JSON.stringify(pdfHtml)} })`);
      const root = path.join(target, 'EPS Backup');
      check('Manifest complete', r1.manifest.complete === true);
      check('PDF written', fs.readdirSync(root).some((f) => /^Emergency plan .*\.pdf$/.test(f) && fs.statSync(path.join(root, f)).size > 10000));
      check('Plan data encrypted', fs.existsSync(path.join(root, 'Data', 'plan.epsenc')) && !fs.readFileSync(path.join(root, 'Data', 'plan.epsenc'), 'utf8').includes('Sarah') && !fs.existsSync(path.join(root, 'Data', 'data')));
      check('Vault copied', fs.existsSync(path.join(root, 'Data', 'vault', 'vault.json')) && fs.existsSync(path.join(root, 'Data', 'vault', 'index.bin')));
      check('README written', fs.readFileSync(path.join(root, 'README.txt'), 'utf8').includes('password'));
      const r2 = await js(`window.api.usb.run(${JSON.stringify(target)}, { plan: false, vault: true, library: false, tiles: false, app: false })`);
      check('Second backup skips unchanged vault files', r2.manifest.contents.vault.copied === 0 && r2.manifest.contents.vault.skipped >= 2, JSON.stringify(r2.manifest.contents.vault));
      check('Earlier plan backup still listed', !!r2.manifest.contents.plan && !!r2.manifest.contents.plan.fromEarlier);

      // Restore
      await js(`window.api.store.set('household', { name: 'CHANGED', people: [], pets: [] })`);
      check('Wrong backup password refused', await js(`window.api.usb.restore(${JSON.stringify(target)}, { plan: true, password: 'nope nope' }).then(() => false, (e) => e.message.includes('not correct'))`));
      const rr = await js(`window.api.usb.restore(${JSON.stringify(target)}, { plan: true, password: 'backup pass 1' })`);
      const hh = JSON.parse(fs.readFileSync(path.join(dataDir, 'data', 'household.json'), 'utf8'));
      check('Plan restored', hh.name === 'Jones household' && hh.people.length === 2, rr.restored.join(','));
      check('Pre-restore copy kept', !!rr.savedTo && fs.existsSync(path.join(rr.savedTo, 'data', 'household.json')));
      const st = JSON.parse(fs.readFileSync(path.join(dataDir, 'data', 'settings.json'), 'utf8'));
      check('Backup date saved', !!st.lastUsbBackup);
    } catch (e) {
      results.push('ERROR ' + e.stack);
    }
    console.log(results.join('\n'));
    app.exit(0);
  });
});
