// Checks the moves from "Emergency Planning System" and "Holdfast Emergency Planning System" to the current name: the
// newest old data folder is moved across on first run (the older one is left alone),
// and a USB backup made under the old name ("EPS Backup") is still found, then renamed by the next backup.
// Usage: npx electron scripts/rename-test.js
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'holdfast-rename-'));
const oldDir = path.join(appData, 'Holdfast Emergency Planning System');
const olderDir = path.join(appData, 'Emergency Planning System');
fs.mkdirSync(path.join(olderDir, 'data'), { recursive: true });
const newDir = path.join(appData, app.getName());
fs.mkdirSync(path.join(oldDir, 'data'), { recursive: true });
fs.writeFileSync(path.join(oldDir, 'data', 'settings.json'), JSON.stringify({ dataVersion: 2 }));
fs.writeFileSync(path.join(oldDir, 'data', 'household.json'), JSON.stringify({ name: 'Migrated household', people: [], pets: [] }));
// Pretend this temp folder is %APPDATA%, so the app's default data folder is inside it.
app.setPath('appData', appData);
app.setPath('userData', newDir);

const drive = fs.mkdtempSync(path.join(os.tmpdir(), 'holdfast-rename-drive-'));
const legacy = path.join(drive, 'EPS Backup');
fs.mkdirSync(path.join(legacy, 'Data', 'data'), { recursive: true });
fs.writeFileSync(path.join(legacy, 'backup.json'), JSON.stringify({ format: 'eps-backup-folder', version: 1, created: '2026-01-01T00:00:00.000Z', complete: true, contents: {} }));
fs.writeFileSync(path.join(legacy, 'Start Emergency Planning System.cmd'), '@echo old launcher\r\n');
process.env.HOLDFAST_IGNORE_DRIVES = '1'; // never touch a real backup drive that is plugged in
require('../src/main/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra = '') => results.push(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ' (' + extra + ')' : ''}`);

app.on('browser-window-created', (_e, win) => {
  if (win.id !== 1) return;
  win.webContents.once('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c);
    try {
      await wait(1200);
      check('Window title', win.getTitle() === 'Holdfast Emergency Preparation System', win.getTitle());
      check('Old data folder moved', !fs.existsSync(oldDir) && fs.existsSync(path.join(newDir, 'data', 'household.json')));
      check('Older data folder left alone', fs.existsSync(path.join(olderDir, 'data')));
      check('Moved data loads in the app', (await js(`document.getElementById('navfoot').innerText`)).includes('Migrated household'));
      check('Sidebar brand', (await js(`document.querySelector('.brand').innerText`)).replace(/\s+/g, ' ').trim() === 'HOLDFAST Emergency preparation system');

      const T = JSON.stringify(drive);
      check('Old-name backup found', (await js(`window.api.usb.preview(${T})`)).root === legacy);
      await js(`window.api.usb.run(${T}, { plan: true, vault: false })`);
      const now = path.join(drive, 'Holdfast Backup');
      check('Backup folder renamed to Holdfast Backup', fs.existsSync(path.join(now, 'backup.json')) && !fs.existsSync(legacy));
      check('Old launcher removed only when the program is copied', fs.existsSync(path.join(now, 'Start Emergency Planning System.cmd')));
      check('README on drive uses the new name', fs.readFileSync(path.join(now, 'README.txt'), 'utf8').startsWith('HOLDFAST EMERGENCY PREPARATION SYSTEM BACKUP'));
    } catch (e) {
      results.push('ERROR ' + e.stack);
    }
    console.log(results.join('\n'));
    app.exit(0);
  });
});
