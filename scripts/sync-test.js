// Round trip: back up, edit the drive copy as if on another computer, edit this PC too, then review and merge.
// Usage: npx electron scripts/sync-test.js
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eps-sync-'));
const target = fs.mkdtempSync(path.join(os.tmpdir(), 'eps-sync-drive-'));
app.setPath('userData', dataDir);
fs.mkdirSync(path.join(dataDir, 'data'), { recursive: true });
const w = (dir, k, v) => fs.writeFileSync(path.join(dir, k + '.json'), JSON.stringify(v));
w(path.join(dataDir, 'data'), 'settings', { dataVersion: 2 });
w(path.join(dataDir, 'data'), 'household', { name: 'Jones household', postcode: 'CF10 1AA', people: [{ id: 'mum', name: 'Sarah Jones', mobile: '07700 900111' }], pets: [] });
w(path.join(dataDir, 'data'), 'contacts', [{ id: 'gran', name: 'Mary Evans', phone: '07700 900222', email: '' }, { id: 'gp', name: 'GP surgery', phone: '029 2000 0000' }]);
w(path.join(dataDir, 'data'), 'markers', [{ id: 'm1', name: 'Rest centre' }]);
process.env.HOLDFAST_IGNORE_DRIVES = '1'; // never touch a real backup drive that is plugged in
require('../src/main/main.js');
const { Vault } = require('../src/main/vault.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra = '') => results.push(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ' (' + extra + ')' : ''}`);
const err = (e) => String(e && e.message || e);

app.on('browser-window-created', (_e, win) => {
  if (win.id !== 1) return;
  win.webContents.once('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c);
    const T = JSON.stringify(target);
    const pcFile = (k) => JSON.parse(fs.readFileSync(path.join(dataDir, 'data', k + '.json'), 'utf8'));
    try {
      await wait(1200);
      await js(`window.api.vault.create('vault password 1')`);
      const e1 = await js(`window.api.vault.saveEntry({ name: 'Passport', category: 'Identity' })`);
      await js(`window.api.vault.addFiles('${e1.id}', [{ name: 'passport.txt', type: 'text/plain', data: new TextEncoder().encode('PASSPORT') }])`);
      await js(`window.api.usb.run(${T}, { plan: true, vault: true })`);
      const root = path.join(target, 'Holdfast Backup');
      check('Backup has an id and this PC kept a base', !!JSON.parse(fs.readFileSync(path.join(root, 'backup.json'))).id && fs.readdirSync(path.join(dataDir, 'sync-bases')).length === 2);
      check('Unedited drive: nothing to review', (await js(`window.api.usb.preview(${T})`)).usbChanges === 0);
      await wait(2500);

      // ---- "Another computer" edits the drive ----
      const ud = path.join(root, 'Data', 'data');
      const uc = JSON.parse(fs.readFileSync(path.join(ud, 'contacts.json')));
      uc[0].phone = '07700 999999';                       // changed on drive only
      uc.push({ id: 'bob', name: 'Bob (neighbour)', phone: '07700 900333' }); // added on drive
      w(ud, 'contacts', uc);
      const uh = JSON.parse(fs.readFileSync(path.join(ud, 'household.json')));
      uh.people.push({ id: 'lily', name: 'Lily Jones', role: 'Child', carer1: 'p:mum' });
      uh.people[0].mobile = '07700 000001';               // conflict: also changed on this PC
      w(ud, 'household', uh);
      fs.rmSync(path.join(ud, 'markers.json'));           // missing file must not delete anything
      const other = new Vault(path.join(root, 'Data', 'vault'), () => {});
      await other.unlock('vault password 1');
      const e2 = other.saveEntry({ name: 'Car insurance', category: 'Insurance' });
      other.addFiles(e2.id, [{ name: 'car.txt', type: 'text/plain', data: Buffer.from('CAR POLICY') }]);
      other.lock();

      // ---- This PC edits too ----
      await js(`window.api.store.set('contacts', ${JSON.stringify([{ id: 'gran', name: 'Mary Evans', phone: '07700 900222', email: 'mary@example.com' }, { id: 'gp', name: 'GP surgery', phone: '029 2000 0000' }])})`);
      await js(`window.api.store.set('household', ${JSON.stringify({ name: 'The Joneses', postcode: 'CF10 1AA', people: [{ id: 'mum', name: 'Sarah Jones', mobile: '07700 000002' }], pets: [] })})`);
      await js(`window.api.vault.lock()`);

      check('Backup refuses to overwrite drive changes', (await js(`window.api.usb.run(${T}, { plan: true, vault: true }).then(() => 'ran', (e) => e.message)`)).includes('USB_HAS_CHANGES'));
      const scanned = await js(`window.api.usb.syncStatus()`);
      check('Drive scan runs', Array.isArray(scanned));

      let p = await js(`window.api.usb.preview(${T})`);
      const ids = p.changes.map((c) => `${c.kind}:${c.id}`);
      check('Drive-only edit listed', ids.includes('usb:contacts/gran/phone'), ids.join(' '));
      check('Drive-added contact listed', ids.includes('usb:contacts/bob'));
      check('Drive-added person listed', ids.includes('usb:household/people/lily'));
      check('Both-sides edit is a conflict', ids.includes('conflict:household/people/mum/mobile'));
      check('PC-only edits not listed', !ids.some((i) => i.includes('email') || i.endsWith('household/name')) && p.pcChanges >= 2, 'pcChanges ' + p.pcChanges);
      check('Missing file on drive is not a deletion', !ids.some((i) => i.includes('markers')));
      check('Locked vault flagged', p.vault.state === 'locked');
      check('Apply refused while vault locked', await js(`window.api.usb.apply(${T}, {}).then(() => false, () => true)`));

      await js(`window.api.vault.unlock('vault password 1', false)`);
      p = await js(`window.api.usb.preview(${T})`);
      check('Vault document added on drive listed', p.changes.some((c) => c.kind === 'usb' && c.label[0] === 'Document vault' && c.label[1] === 'Car insurance'), p.vault.state);

      await js(`window.go('usb', { path: ${T} })`);
      await wait(1500);
      check('Review panel shown', await js(`document.body.innerText.toLowerCase().includes('made on another computer')`));
      if (process.env.EPS_SHOTS) fs.writeFileSync(path.join(process.env.EPS_SHOTS, 'sync-review.png'), (await win.webContents.capturePage()).toPNG());
      const r = await js(`window.api.usb.apply(${T}, { 'household/people/mum/mobile': 'usb' })`);
      const c = pcFile('contacts'), hh = pcFile('household');
      check('Drive phone merged with PC email', c[0].phone === '07700 999999' && c[0].email === 'mary@example.com');
      check('New contact and person merged', c.some((x) => x.id === 'bob') && hh.people.some((x) => x.id === 'lily'));
      check('Conflict resolved as chosen', hh.people.find((x) => x.id === 'mum').mobile === '07700 000001');
      check('PC-only change kept', hh.name === 'The Joneses');
      check('Markers kept', pcFile('markers').length === 1);
      const docs = await js(`window.api.vault.list()`);
      const car = docs.find((d) => d.name === 'Car insurance');
      check('Vault has both documents', docs.length === 2 && !!car, String(r.applied));
      check('New vault file decrypts on this PC', car && (await js(`fetch('vault://file/${car.files[0].id}/x').then((r) => r.text())`)) === 'CAR POLICY');
      const after = await js(`window.api.usb.preview(${T})`);
      check('Drive and PC now match', after.usbChanges === 0 && after.pcChanges === 0, JSON.stringify(after.changes.map((x) => x.id)));
      check('Drive updated with merged data', JSON.parse(fs.readFileSync(path.join(ud, 'household.json'))).name === 'The Joneses');
      check('Backup allowed again', (await js(`window.api.usb.run(${T}, { plan: true, vault: true }).then(() => 'ran', (e) => e.message)`)) === 'ran');
    } catch (e) {
      results.push('ERROR ' + (e.stack || err(e)));
    }
    console.log(results.join('\n'));
    app.exit(0);
  });
});
