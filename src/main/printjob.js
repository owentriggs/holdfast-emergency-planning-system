// The app's own print dialog: what each printer can do, cutting a laid-out PDF down to the chosen pages or into a
// booklet, and printing that PDF without the system dialog (which fails in this Electron version on Windows).
const { app, BrowserWindow } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

// Electron's printer list does not say whether a printer can do duplex or colour, so ask Windows.
function capabilities() {
  if (process.platform !== 'win32') return Promise.resolve({});
  const ps = 'Get-CimInstance Win32_Printer | ForEach-Object { [pscustomobject]@{ n = $_.Name; c = ($_.CapabilityDescriptions -join \',\'); o = $_.WorkOffline } } | ConvertTo-Json -Compress';
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 15000 }, (err, out) => {
    if (err) return resolve({});
    try {
      resolve(Object.fromEntries([].concat(JSON.parse(out) || []).map((p) => [p.n, { caps: String(p.c || '').split(','), offline: !!p.o }])));
    } catch (e) {
      resolve({});
    }
  }));
}

// Default printer first. Where Windows did not say, every option is offered and the driver ignores what it cannot do.
async function printers(wc) {
  const [list, caps] = await Promise.all([wc.getPrintersAsync(), capabilities()]);
  return list.map((p) => {
    const c = caps[p.name];
    const has = (k) => (c ? c.caps.includes(k) : true);
    return { name: p.name, label: p.displayName || p.name, isDefault: !!p.isDefault, offline: !!(c && c.offline), duplex: has('Duplex'), color: has('Color'), collate: has('Collate') };
  }).sort((a, b) => b.isDefault - a.isDefault || a.label.localeCompare(b.label));
}

// A4 landscape, in points.
const SHEET = [841.89, 595.28];

// pages: 1-based page numbers to keep, in order (empty or missing for all). booklet: lay them two to a landscape sheet
// in folding order, padded with blank pages to a multiple of four.
async function arrange(pdf, { pages, booklet } = {}) {
  const src = await PDFDocument.load(pdf);
  const total = src.getPageCount();
  const keep = (pages && pages.length ? pages.filter((n) => n >= 1 && n <= total) : src.getPageIndices().map((i) => i + 1));
  if (!booklet && keep.length === total && keep.every((n, i) => n === i + 1)) return { pdf, total, numbers: keep };
  const out = await PDFDocument.create();
  if (!booklet) {
    (await out.copyPages(src, keep.map((n) => n - 1))).forEach((p) => out.addPage(p));
  } else {
    const emb = await out.embedPages(keep.map((n) => src.getPage(n - 1)));
    const n = Math.ceil(emb.length / 4) * 4;
    const [W, H] = SHEET;
    const side = (...nums) => {
      const page = out.addPage(SHEET);
      nums.forEach((k, half) => {
        const e = emb[k - 1];
        if (!e) return;
        const s = Math.min(W / 2 / e.width, H / e.height);
        page.drawPage(e, { x: half * (W / 2) + (W / 2 - e.width * s) / 2, y: (H - e.height * s) / 2, xScale: s, yScale: s });
      });
    };
    for (let i = 0; i < n / 4; i++) {
      side(n - 2 * i, 1 + 2 * i);
      side(2 + 2 * i, n - 1 - 2 * i);
    }
  }
  return { pdf: Buffer.from(await out.save()), total, numbers: keep };
}

// Chromium's PDF viewer does the printing, so the paper matches the preview. The viewer loads the document after the
// page itself has loaded, hence the pause.
async function printPdf(pdf, o) {
  const tmp = path.join(app.getPath('temp'), `holdfast-print-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, pdf);
  const pw = new BrowserWindow({ show: false, webPreferences: { plugins: true } });
  try {
    await pw.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 1500));
    return await new Promise((resolve) => pw.webContents.print({
      silent: true, printBackground: true, deviceName: o.deviceName, copies: o.copies || 1, collate: o.collate !== false,
      color: o.color !== false, duplexMode: o.duplexMode || 'simplex', landscape: !!o.landscape, ...(o.pageSize ? { pageSize: o.pageSize } : {}),
    }, (ok, reason) => resolve({ ok, reason })));
  } finally {
    pw.destroy();
    fs.rmSync(tmp, { force: true });
  }
}

// For the system's own print dialog: open the PDF in the default PDF viewer. The file is left in the temp folder
// because the viewer still has it open.
function tempPdf(pdf, name) {
  const file = path.join(app.getPath('temp'), `${String(name || 'Holdfast').replace(/[\\/:*?"<>|]/g, '')} ${Date.now().toString(36)}.pdf`);
  fs.writeFileSync(file, pdf);
  return file;
}

module.exports = { printers, arrange, printPdf, tempPdf };
