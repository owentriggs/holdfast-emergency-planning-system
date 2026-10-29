// Renders src/assets/logo.svg to PNGs and a multi-size Windows .ico (PNG-compressed entries).
// Usage: npx electron scripts/build-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SVG = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'logo.svg'), 'utf8');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 256, height: 256, frame: false, transparent: true, webPreferences: { offscreen: true } });
  const pngs = {};
  for (const s of SIZES) {
    win.setContentSize(s, s);
    const html = `<html><body style="margin:0;background:transparent">${SVG.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`;
    await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
    await new Promise((r) => setTimeout(r, 150));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: s, height: s });
    pngs[s] = img.resize({ width: s, height: s, quality: 'best' }).toPNG();
  }
  const outDir = path.join(ROOT, 'build');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'icon.png'), pngs[256]);
  fs.writeFileSync(path.join(ROOT, 'src', 'assets', 'icon-256.png'), pngs[256]);
  fs.writeFileSync(path.join(ROOT, 'src', 'assets', 'icon-32.png'), pngs[32]);

  // ICO: header, directory entries, then PNG data.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(SIZES.length, 4);
  const dir = Buffer.alloc(16 * SIZES.length);
  let offset = 6 + dir.length;
  SIZES.forEach((s, i) => {
    const d = pngs[s];
    dir.writeUInt8(s >= 256 ? 0 : s, i * 16);
    dir.writeUInt8(s >= 256 ? 0 : s, i * 16 + 1);
    dir.writeUInt8(0, i * 16 + 2);
    dir.writeUInt8(0, i * 16 + 3);
    dir.writeUInt16LE(1, i * 16 + 4);
    dir.writeUInt16LE(32, i * 16 + 6);
    dir.writeUInt32LE(d.length, i * 16 + 8);
    dir.writeUInt32LE(offset, i * 16 + 12);
    offset += d.length;
  });
  const ico = Buffer.concat([header, dir, ...SIZES.map((s) => pngs[s])]);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
  fs.writeFileSync(path.join(ROOT, 'src', 'assets', 'icon.ico'), ico);
  console.log('icons written', SIZES.join(','));
  app.exit(0);
});
