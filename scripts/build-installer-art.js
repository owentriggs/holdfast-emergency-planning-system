// Renders the installer's hexagon artwork to the 24-bit BMPs NSIS needs:
//   build/installerSidebar.bmp  164x314, Welcome and Finish pages (also used by the uninstaller)
//   build/installerHeader.bmp   150x57, top right of the other pages
// Usage: npx electron scripts/build-installer-art.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOGO = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'logo.svg'), 'utf8');
// The pattern lives in an ES module shared with the PDF cover; read it as text and call it in the page.
const TEKTUR = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'fonts', 'tektur-600.woff2')).toString('base64');
const HEX = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'lib', 'hexfield.js'), 'utf8').replace(/^export /m, '');

const ART = [
  {
    file: 'installerSidebar.bmp', w: 164, h: 314,
    body: `<script>${HEX}; document.write(hexField(164, 240, 15, { unit: 'px', seed: 23, density: 0.34 }))</script>
      <div style="position:absolute;left:16px;bottom:18px;font:600 16px Tektur;letter-spacing:1.5px;color:#1b1b1b;display:flex;align-items:center;gap:9px">
        ${LOGO.replace('<svg ', '<svg width="30" height="30" ')}HOLDFAST</div>
      <div style="position:absolute;left:16px;bottom:6px;font:9px 'Segoe UI';color:#5f6368">Emergency planning system</div>`,
  },
  {
    file: 'installerHeader.bmp', w: 150, h: 57,
    body: `<script>${HEX}; document.write(hexField(150, 57, 11, { from: 'right', unit: 'px', seed: 5, density: 0.32 }))</script>`,
  },
];

// Bottom-up 24-bit BMP from a BGRA bitmap.
function bmp(bgra, w, h) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const out = Buffer.alloc(54 + row * h);
  out.write('BM', 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(w, 18);
  out.writeInt32LE(h, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = 54 + (h - 1 - y) * row + x * 3;
      out[d] = bgra[s];
      out[d + 1] = bgra[s + 1];
      out[d + 2] = bgra[s + 2];
    }
  }
  return out;
}

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, frame: false, webPreferences: { offscreen: true } });
  for (const a of ART) {
    win.setContentSize(a.w, a.h);
    const html = `<html><style>@font-face { font-family: Tektur; font-weight: 600; src: url(data:font/woff2;base64,${TEKTUR}) format('woff2'); }</style><body style="margin:0;width:${a.w}px;height:${a.h}px;overflow:hidden;position:relative;background:#fff">${a.body}</body></html>`;
    await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    await new Promise((r) => setTimeout(r, 300));
    const img = (await win.webContents.capturePage({ x: 0, y: 0, width: a.w, height: a.h })).resize({ width: a.w, height: a.h, quality: 'best' });
    fs.writeFileSync(path.join(ROOT, 'build', a.file), bmp(img.toBitmap(), a.w, a.h));
  }
  console.log('installer art written:', ART.map((a) => a.file).join(', '));
  app.exit(0);
});
