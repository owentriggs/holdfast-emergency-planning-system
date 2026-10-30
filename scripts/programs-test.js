// "Programs for other computers" on a USB backup, against a stand-in for the GitHub releases API: the Mac versions
// are downloaded once and copied to the drive, kept for later backups (also when offline), and a newer release
// replaces them.
// Usage: npx electron scripts/programs-test.js
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holdfast-programs-'));
const target = fs.mkdtempSync(path.join(os.tmpdir(), 'holdfast-programs-drive-'));
app.setPath('userData', dataDir);
fs.mkdirSync(path.join(dataDir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'data', 'settings.json'), JSON.stringify({ dataVersion: 2 }));

// The release server: /latest lists the assets, /files/<name> serves them. Counts downloads.
let release = { tag: 'v0.4.0', files: { 'Holdfast-0.4.0-mac-apple-silicon.dmg': 'ARM'.repeat(1000), 'Holdfast-0.4.0-mac-intel.dmg': 'X64'.repeat(1000), 'Holdfast Emergency Preparation System Setup 0.4.0.exe': 'SETUP' } };
const downloads = [];
const server = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${server.address().port}`;
  if (req.url === '/latest') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ tag_name: release.tag, assets: Object.entries(release.files).map(([name, body]) => ({ name, size: body.length, browser_download_url: `${base}/files/${encodeURIComponent(name)}` })) }));
  }
  const name = decodeURIComponent(req.url.replace('/files/', ''));
  if (!(name in release.files)) { res.writeHead(404); return res.end(); }
  downloads.push(name);
  res.writeHead(200);
  res.end(release.files[name]);
});

server.listen(0, '127.0.0.1', () => { process.env.HOLDFAST_RELEASES_URL = `http://127.0.0.1:${server.address().port}/latest`; });
process.env.HOLDFAST_IGNORE_DRIVES = '1'; // never touch a real backup drive that is plugged in
require('../src/main/main.js');

const results = [];
const check = (label, ok, extra = '') => results.push(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ' (' + extra + ')' : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

{
  app.on('browser-window-created', (_e, win) => {
    if (win.id !== 1) return;
    win.webContents.once('did-finish-load', async () => {
      const js = (c) => win.webContents.executeJavaScript(c);
      const T = JSON.stringify(target);
      const root = path.join(target, 'Holdfast Backup');
      const onDrive = (n) => path.join(root, 'Programs', 'Mac', n);
      const run = () => js(`window.api.usb.run(${T}, { plan: true, others: true })`);
      try {
        await wait(1000);
        const est = await js('window.api.usb.estimate()');
        check('USB page offers the Mac versions', est.others && est.others.wanted.join() === 'Mac (Apple Silicon),Mac (Intel)', JSON.stringify(est.others));
        let r = await run();
        check('Mac versions downloaded', downloads.length === 2 && !downloads.some((d) => /setup/i.test(d)), downloads.join(', '));
        check('Apple Silicon dmg on the drive', fs.readFileSync(onDrive('Holdfast for Apple Silicon Macs.dmg'), 'utf8') === 'ARM'.repeat(1000));
        check('Intel dmg on the drive', fs.readFileSync(onDrive('Holdfast for Intel Macs.dmg'), 'utf8') === 'X64'.repeat(1000));
        check('Backup records the release', r.manifest.contents.others.release === 'v0.4.0' && !r.manifest.contents.others.note);
        check('Drive README explains the Mac version', fs.readFileSync(path.join(root, 'README.txt'), 'utf8').includes('Programs\\Mac'));
        check('Kept on this computer', (await js('window.api.usb.estimate()')).others.missing.length === 0);

        r = await run();
        check('Not downloaded again', downloads.length === 2);

        server.close();
        await wait(200);
        r = await run();
        check('Offline: still copied from what is kept here', r.ok && fs.existsSync(onDrive('Holdfast for Intel Macs.dmg')) && !r.manifest.contents.others.note, String(r.manifest.contents.others.note));

        fs.rmSync(path.join(dataDir, 'programs'), { recursive: true });
        r = await run();
        check('Offline with nothing kept: backup still finishes, with a note', r.ok && /Could not reach GitHub/.test(r.manifest.contents.others.note || ''), r.manifest.contents.others.note);

        await new Promise((res) => server.listen(Number(new URL(process.env.HOLDFAST_RELEASES_URL).port), '127.0.0.1', res));
        release = { tag: 'v0.4.1', files: { 'Holdfast-0.4.1-mac-apple-silicon.dmg': 'NEW'.repeat(1000) } };
        downloads.length = 0;
        r = await run();
        check('Newer release downloaded', downloads.join() === 'Holdfast-0.4.1-mac-apple-silicon.dmg' && fs.readFileSync(onDrive('Holdfast for Apple Silicon Macs.dmg'), 'utf8') === 'NEW'.repeat(1000));
        check('A version missing from the release is noted', /no Mac \(Intel\) version/.test(r.manifest.contents.others.note || ''), r.manifest.contents.others.note);
      } catch (e) {
        results.push('ERROR ' + e.stack);
      }
      console.log(results.join('\n'));
      server.close();
      app.exit(0);
    });
  });
}
