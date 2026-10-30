// Round trip with the phone app: back up with a phone copy (password protected, with the vault), open it in the real
// phone app (web-dist, served locally and loaded in a hidden window), edit there and on this PC, save the phone's
// changes file and merge it back here.
// Usage: node scripts/build-web.js && npx electron scripts/phone-test.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const WEB = path.join(__dirname, '..', 'web-dist');
if (!fs.existsSync(path.join(WEB, 'web', 'api.js'))) { console.log('Run node scripts/build-web.js first'); process.exit(1); }
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holdfast-phone-'));
const target = fs.mkdtempSync(path.join(os.tmpdir(), 'holdfast-phone-drive-'));
app.setPath('userData', dataDir);
fs.mkdirSync(path.join(dataDir, 'data'), { recursive: true });
const w = (dir, k, v) => fs.writeFileSync(path.join(dir, k + '.json'), JSON.stringify(v));
w(path.join(dataDir, 'data'), 'settings', { dataVersion: 2 });
w(path.join(dataDir, 'data'), 'household', { name: 'Jones household', postcode: 'CF10 1AA', people: [{ id: 'mum', name: 'Sarah Jones', mobile: '07700 900111' }], pets: [] });
w(path.join(dataDir, 'data'), 'contacts', [{ id: 'gran', name: 'Mary Evans', phone: '07700 900222', email: '' }, { id: 'gp', name: 'GP surgery', phone: '029 2000 0000' }]);
process.env.HOLDFAST_IGNORE_DRIVES = '1'; // never touch a real backup drive that is plugged in
require('../src/main/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra = '') => results.push(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ' (' + extra + ')' : ''}`);
const BACKUP_PW = 'backup pass 1';
const VAULT_PW = 'vault password 1';

// The phone app as a static site, plus the phone file at /test/phone.holdfast.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
let phoneFile = null;
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = p === '/test/phone.holdfast' ? phoneFile : path.join(WEB, p === '/' ? 'index.html' : p);
  if (!file || !file.startsWith(p === '/test/phone.holdfast' ? target : WEB) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

app.on('browser-window-created', (_e, win) => {
  if (win.id !== 1) return;
  win.webContents.once('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c);
    const T = JSON.stringify(target);
    const pcFile = (k) => JSON.parse(fs.readFileSync(path.join(dataDir, 'data', k + '.json'), 'utf8'));
    try {
      await wait(1200);
      // ---- This PC: a vault, then a backup with a phone copy ----
      await js(`window.api.vault.create(${JSON.stringify(VAULT_PW)})`);
      const e1 = await js(`window.api.vault.saveEntry({ name: 'Passport', category: 'Identity' })`);
      await js(`window.api.vault.addFiles('${e1.id}', [{ name: 'passport.txt', type: 'text/plain', data: new TextEncoder().encode('PASSPORT 123') }])`);
      const { PDFDocument } = require('pdf-lib');
      const pdf = await PDFDocument.create();
      pdf.addPage([200, 200]).drawText('Policy', { x: 20, y: 100 });
      pdf.addPage([200, 200]);
      const pdfBytes = JSON.stringify([...(await pdf.save())]);
      await js(`window.api.vault.addFiles('${e1.id}', [{ name: 'policy.pdf', type: 'application/pdf', data: new Uint8Array(${pdfBytes}) }])`);
      const r = await js(`window.api.usb.run(${T}, { plan: true, password: ${JSON.stringify(BACKUP_PW)}, vault: true, phone: true })`);
      const root = path.join(target, 'Holdfast Backup');
      phoneFile = path.join(root, 'Holdfast phone.holdfast');
      check('Phone file written', fs.existsSync(phoneFile) && r.manifest.contents.phone && r.manifest.contents.phone.encrypted);
      check('Base kept for the phone copy', fs.existsSync(path.join(dataDir, 'sync-bases', `phone-${r.manifest.contents.phone.id}.json`)));
      check('Plan in the phone file is not readable without the password', !fs.readFileSync(phoneFile).includes('Mary Evans'));

      // This PC changes the GP's number (only here) and the mobile (the phone changes it too).
      const pc = pcFile('contacts'); pc[1].phone = '029 2000 1111';
      await js(`window.api.store.set('contacts', ${JSON.stringify(pc)})`);
      const hh = pcFile('household'); hh.people[0].mobile = '07700 000001';
      await js(`window.api.store.set('household', ${JSON.stringify(hh)})`);

      // ---- The phone app ----
      await new Promise((res) => server.listen(0, '127.0.0.1', res));
      const phone = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { partition: 'phone-test-' + Date.now() } });
      const pjs = (c) => phone.webContents.executeJavaScript(c);
      const errs = [];
      phone.webContents.on('console-message', (_ev, level, msg) => { if (level >= 3) errs.push(msg); });
      const url = `http://localhost:${server.address().port}/`;
      await phone.loadURL(url);
      await wait(1500);
      check('Phone app starts on Phone copy', (await pjs('location.hash')) === '#phone');
      check('Desktop-only pages hidden', !(await pjs(`document.getElementById('navlist').innerText`)).includes('USB backup'));
      const open = (pw) => pjs(`(async () => { const b = await (await fetch('test/phone.holdfast')).blob(); try { await window.api.phone.importFile(new File([b], 'Holdfast phone.holdfast'), ${JSON.stringify(pw)}); return 'ok'; } catch (e) { return e.message; } })()`);
      check('Asks for the backup password', (await open(null)) === 'PASSWORD_NEEDED');
      check('Wrong password refused', (await open('nope nope')) === 'PASSWORD_WRONG');
      check('Opens with the backup password', (await open(BACKUP_PW)) === 'ok');
      await phone.loadURL(url + '#dashboard');
      phone.webContents.reload(); // as the Phone copy page does after opening a file
      await wait(1500);
      check('Plan shows on the phone', (await pjs(`document.getElementById('navfoot').innerText`)).includes('Jones household'));
      check('Unlocks the vault with its usual password', await pjs(`window.api.vault.unlock(${JSON.stringify(VAULT_PW)}).then(() => true, (e) => e.message)`) === true);
      const text = await pjs(`(async () => { const l = await window.api.vault.list(); const u = await window.api.vault.fileUrl(l[0].files[0].id); return (await fetch(u)).text(); })()`);
      check('Reads a vault file from the computer', text === 'PASSPORT 123', text);
      const pages = await pjs(`(async () => {
        const f = (await window.api.vault.list())[0].files.find((x) => x.type === 'application/pdf');
        const data = new Uint8Array(await (await fetch(await window.api.vault.fileUrl(f.id))).arrayBuffer());
        const lib = await (await import('./lib/printdialog.js')).loadPdfjs();
        return (await lib.getDocument({ data, isEvalSupported: false }).promise).numPages;
      })().catch((e) => e.message)`);
      check('PDF viewer works in the phone app', pages === 2, String(pages));
      await pjs(`(async () => {
        const e = await window.api.vault.saveEntry({ name: 'Car insurance', category: 'Insurance' });
        await window.api.vault.addFiles(e.id, [{ name: 'car.txt', type: 'text/plain', data: new TextEncoder().encode('CAR POLICY') }]);
        const c = await window.api.store.all();
        c.contacts[0].phone = '07700 999999';
        c.contacts.push({ id: 'bob', name: 'Bob (neighbour)', phone: '07700 900333' });
        c.household.people[0].mobile = '07700 555555';
        await window.api.store.set('contacts', c.contacts);
        await window.api.store.set('household', c.household);
      })()`);
      check('Phone notes edits not yet sent', (await pjs(`window.api.phone.status()`)).changed === true);
      for (const id of ['contacts', 'vault', 'checklists', 'firstaid', 'settings', 'phone']) {
        await pjs(`window.go('${id}')`);
        await wait(400);
        const t = await pjs(`document.getElementById('page').innerText`);
        check(`Phone page ${id} renders`, t.length > 20 && !t.includes('Error loading page'), t.slice(0, 60).replace(/\s+/g, ' '));
      }
      check('Saving changes asks for the password again', (await pjs(`window.api.phone.exportChanges(null).then(() => 'ok', (e) => e.message)`)) === 'PASSWORD_NEEDED');
      const out = await pjs(`(async () => { const r = await window.api.phone.exportChanges(${JSON.stringify(BACKUP_PW)}); const b = new Uint8Array(await r.blob.arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return { name: r.name, data: btoa(s) }; })()`);
      check('Changes file named for the computer to find', /^Holdfast changes .*\.holdfast$/.test(out.name), out.name);
      check('Edits marked as sent', (await pjs(`window.api.phone.status()`)).changed === false);
      check('No errors in the phone app', !errs.length, errs.join(' | '));
      phone.destroy();

      // ---- Back on this PC ----
      const changes = path.join(root, out.name);
      fs.writeFileSync(changes, Buffer.from(out.data, 'base64'));
      check('Changes file found on the drive', (await js(`window.api.usb.phoneChanges(${T})`)).length === 1);
      const F = JSON.stringify(changes);
      check('Opening it asks for the backup password', (await js(`window.api.usb.openPhoneChanges(${F}, null).then(() => 'ok', (e) => e.message)`)).includes('PASSWORD_NEEDED'));
      const { root: tmp } = await js(`window.api.usb.openPhoneChanges(${F}, ${JSON.stringify(BACKUP_PW)})`);
      // The vault here locks itself when Windows has been idle for a few minutes, as it is during a test run.
      await js(`window.api.vault.status().then((s) => s.unlocked || window.api.vault.unlock(${JSON.stringify(VAULT_PW)}))`);
      const p = await js(`window.api.usb.preview(${JSON.stringify(tmp)})`);
      const labels = p.changes.map((c) => `${c.kind}:${c.label.join('>')}`);
      check('Phone edit listed', labels.some((l) => l.startsWith('usb:Contacts>Mary Evans')), labels.join(', '));
      check('Phone addition listed', labels.some((l) => l.includes('Bob')));
      check('Both changed the mobile: conflict', p.changes.some((c) => c.kind === 'conflict'));
      check('Edit made only on this PC is not listed as a phone change', !labels.some((l) => l.includes('GP surgery')));
      check('New vault document listed', labels.some((l) => l.includes('Car insurance')), labels.join(', '));
      await js(`window.api.usb.apply(${JSON.stringify(tmp)}, {})`);
      await wait(500);
      const c2 = pcFile('contacts');
      check('Phone edit merged', c2.find((c) => c.id === 'gran').phone === '07700 999999');
      check('Phone addition merged', !!c2.find((c) => c.id === 'bob'));
      check('PC edit kept', c2.find((c) => c.id === 'gp').phone === '029 2000 1111');
      check('Conflict keeps this PC by default', pcFile('household').people[0].mobile === '07700 000001');
      const car = await js(`(async () => { const l = await window.api.vault.list(); const e = l.find((x) => x.name === 'Car insurance'); return e && e.files.length ? (await (await fetch('vault://file/' + e.files[0].id + '/x')).text()) : null; })()`);
      check('Vault file added on the phone opens here', car === 'CAR POLICY', String(car));
      check('Changes file marked as merged', !fs.existsSync(changes) && (await js(`window.api.usb.phoneChanges(${T})`)).length === 0);
    } catch (e) {
      results.push('ERROR ' + e.stack);
    }
    console.log(results.join('\n'));
    server.close();
    app.exit(0);
  });
});
