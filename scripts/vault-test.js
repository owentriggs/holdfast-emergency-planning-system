// Exercises the document vault: create, encrypt, preview, lock, wrong password, recovery code.
// Usage: npx electron scripts/vault-test.js   (screenshots go to EPS_SHOTS or the OS temp folder)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eps-vault-'));
const shots = process.env.EPS_SHOTS || dataDir;
app.setPath('userData', dataDir);
require('../src/main/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra = '') => results.push(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ' (' + extra + ')' : ''}`);

app.on('browser-window-created', (_e, win) => {
  if (win.id !== 1) return;
  win.webContents.on('console-message', (_ev, level, message) => level >= 2 && console.log('console:', message));
  win.webContents.once('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c);
    const shot = async (name) => fs.writeFileSync(path.join(shots, name), (await win.webContents.capturePage()).toPNG());
    try {
      await wait(1200);
      await js(`window.go('vault')`);
      await wait(600);
      check('Setup screen shown', await js(`document.body.innerText.toLowerCase().includes('create the document vault')`));
      await shot('vault-1-setup.png');

      const code = await js(`window.api.vault.create('correct horse battery').then((r) => r.recoveryCode)`);
      check('Recovery code format', /^([0-9A-Z]{4}-){5}[0-9A-Z]{4}$/.test(code), code);

      // A real PDF, a PNG and a text file.
      const pw = new BrowserWindow({ show: false });
      await pw.loadURL('data:text/html,<h1>Home insurance policy</h1><p>Policy number HX-12345</p>');
      const pdf = await pw.webContents.printToPDF({});
      pw.destroy();
      const png = fs.readFileSync(path.join(__dirname, '..', 'src', 'assets', 'icon-256.png'));
      const files = [
        { name: 'policy.pdf', type: 'application/pdf', data: [...pdf] },
        { name: 'photo.png', type: 'image/png', data: [...png] },
        { name: 'notes.txt', type: 'text/plain', data: [...Buffer.from('SECRET-TEXT-123')] },
      ];
      const entry = await js(`window.api.vault.saveEntry({ name: 'Home insurance SECRETNAME', category: 'Insurance', reference: 'HX-12345', expires: '2026-11-20' })`);
      await js(`window.api.vault.addFiles(${JSON.stringify(entry.id)}, ${JSON.stringify(files)}.map((f) => ({ ...f, data: new Uint8Array(f.data) })))`);

      // Nothing readable on disk.
      const vdir = path.join(dataDir, 'vault');
      const blobs = [path.join(vdir, 'index.bin'), ...fs.readdirSync(path.join(vdir, 'files')).map((f) => path.join(vdir, 'files', f))];
      const leaked = blobs.filter((p) => { const b = fs.readFileSync(p); return b.includes('SECRETNAME') || b.includes('SECRET-TEXT') || b.includes('HX-12345') || b.includes('%PDF') || b.includes('PNG'); });
      check('Files on disk are encrypted', blobs.length === 4 && !leaked.length, `${blobs.length} blobs, ${leaked.length} readable`);
      check('Header has no plaintext key', !fs.readFileSync(path.join(vdir, 'vault.json'), 'utf8').includes('SECRET'));

      await js(`window.go('vault')`);
      await wait(600);
      check('List shows document', await js(`document.body.innerText.includes('Home insurance SECRETNAME')`));
      check('Expiring soon counted', await js(`[...document.querySelectorAll('.stat')].some((s) => s.innerText.includes('Expire within 90 days') && s.querySelector('.v').textContent === '1')`));
      await shot('vault-2-list.png');

      await js(`document.querySelector('.tbl tbody tr').click()`);
      await wait(1500);
      check('PDF preview iframe', await js(`!!document.querySelector('.vaultpreview iframe')`));
      await shot('vault-3-pdf.png');
      await js(`[...document.querySelectorAll('.side .tbl tbody tr')].find((r) => r.innerText.includes('photo.png')).click()`);
      await wait(600);
      check('Image decrypts and renders', await js(`(() => { const i = document.querySelector('.vaultpreview img'); return i && i.complete && i.naturalWidth === 256; })()`));
      await shot('vault-4-image.png');
      await js(`[...document.querySelectorAll('.side .tbl tbody tr')].find((r) => r.innerText.includes('notes.txt')).click()`);
      await wait(600);
      check('Text decrypts', (await js(`document.querySelector('.vaultpreview pre').textContent`)) === 'SECRET-TEXT-123');

      // Editing a field saves.
      await js(`(() => { const i = document.querySelector('.side input'); i.value = 'Home insurance'; i.dispatchEvent(new Event('input')); })()`);
      await wait(700);
      check('Edit saved', (await js(`window.api.vault.list()`))[0].name === 'Home insurance');

      // Lock: protocol refuses, page shows unlock screen.
      const fid = (await js(`window.api.vault.list()`))[0].files[0].id;
      await js(`window.api.vault.lock()`);
      await wait(400);
      check('Unlock screen after lock', await js(`document.body.innerText.toLowerCase().includes('document vault is locked')`));
      check('vault:// refused when locked', (await js(`fetch('vault://file/${fid}').then((r) => r.status)`)) === 403);
      check('List refused when locked', await js(`window.api.vault.list().then(() => false, () => true)`));
      await shot('vault-5-locked.png');

      check('Wrong password rejected', await js(`window.api.vault.unlock('wrong password', false).then(() => false, () => true)`));
      check('Recovery code unlocks (lower case, no dashes)', await js(`window.api.vault.unlock(${JSON.stringify(code.toLowerCase().replace(/-/g, ''))}, true).then(() => true, (e) => e.message)`));
      await js(`window.api.vault.changePassword('new password here', false)`);
      await js(`window.api.vault.lock()`);
      check('Old password stops working', await js(`window.api.vault.unlock('correct horse battery', false).then(() => false, () => true)`));
      check('New password works', await js(`window.api.vault.unlock('new password here', false).then(() => true, (e) => e.message)`));
      check('Data intact after rewrap', (await js(`window.api.vault.list()`))[0].files.length === 3);
    } catch (e) {
      results.push('ERROR ' + e.stack);
    }
    console.log(results.join('\n'));
    console.log('screenshots:', shots);
    app.exit(0);
  });
});
