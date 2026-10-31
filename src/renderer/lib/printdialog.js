// The app's own print dialog. The document is laid out as a PDF; the preview shows that PDF page by page and the
// printer gets exactly the same file, so what is shown is what prints.
import { h, icon, status } from './ui.js';

let pdfjs;
export async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

// Choices are kept for the next time the dialog opens.
const last = { printer: null, copies: 1, collate: true, duplex: 'simplex', color: true, booklet: false };

// "1-3, 6" or "4-" to page numbers, in the order given. Empty means all pages; null means it could not be read.
function parsePages(text, total) {
  const t = text.trim().replace(/\s*-\s*/g, '-');
  if (!t) return [];
  const out = [];
  for (const part of t.split(/[\s,;]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d*))?$/);
    if (!m) return null;
    const a = +m[1];
    const b = m[2] === undefined ? a : m[2] === '' ? total : +m[2];
    if (a < 1 || a > b || b > total) return null;
    for (let i = a; i <= b; i++) out.push(i);
  }
  return out;
}

// Lays the document out and saves it as a PDF, without the dialog.
// sheet: see printDialog.
export async function savePdf(html, name, sheet) {
  const { pdf } = await window.api.print.build(html, sheet ? { label: true } : {});
  const r = await window.api.print.save(pdf, name);
  if (r.ok) status('Saved ' + r.path, 8000);
}

// html: a complete document. name: used for the PDF file name.
// sheet: { landscape, pageSize } for box labels, which set their own page size and are never a booklet.
export function printDialog(html, { name = 'Emergency plan', sheet = null } = {}) {
  return new Promise((resolve) => {
    const o = { ...last, pages: '', booklet: sheet ? false : last.booklet };
    let printers = [];
    let built = null; // { pdf, total, numbers } for the current layout and page choice
    let seq = 0;
    let ready = false; // the preview shows the current choices
    let sending = false;
    const printer = () => printers.find((p) => p.name === o.printer) || {};

    const done = (v) => { dlg.close(); resolve(v); };
    const select = (options, onchange) => h('select', { onchange: (e) => onchange(e.target.value) }, options.map(([v, label]) => h('option', { value: v }, label)));

    const view = h('div', { class: 'pview' });
    const note = h('div', { class: 'note' });
    const summary = h('div', { class: 'muted small' });
    const printerSel = h('select', { onchange: (e) => { o.printer = e.target.value; sync(); } }, h('option', null, 'Finding printers...'));
    const copies = h('input', { type: 'number', min: 1, max: 99, value: o.copies, style: 'width:60px', oninput: (e) => { o.copies = Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)); sync(); } });
    const collate = h('input', { type: 'checkbox', checked: o.collate, onchange: (e) => { o.collate = e.target.checked; } });
    const collateLbl = h('label', { class: 'chk' }, collate, 'Collate');
    const pages = h('input', { type: 'text', placeholder: 'All', oninput: () => { clearTimeout(pages.t); pages.t = setTimeout(rebuild, 400); } });
    const pagesOf = h('span', { class: 'muted small', style: 'white-space:nowrap' });
    const layout = select([['normal', 'One page per side'], ['booklet', 'Booklet (A5, fold in half)']], (v) => { o.booklet = v === 'booklet'; sync(); rebuild(); });
    const duplex = select([['simplex', 'One-sided'], ['longEdge', 'Two-sided, flip on long edge'], ['shortEdge', 'Two-sided, flip on short edge']], (v) => { o.duplex = v; sync(); });
    const color = select([['color', 'Colour'], ['mono', 'Black and white']], (v) => { o.color = v === 'color'; sync(); });
    layout.value = o.booklet ? 'booklet' : 'normal';
    duplex.value = o.duplex;
    color.value = o.color ? 'color' : 'mono';

    const printBtn = h('button', { class: 'primary', disabled: true, onclick: () => run() }, icon('printer'), 'Print');
    const saveBtn = h('button', { disabled: true, onclick: async () => { const r = await window.api.print.save(built.pdf, name + (o.booklet ? ' (booklet)' : '')); if (r.ok) status('Saved ' + r.path, 8000); } }, 'Save as PDF...');
    const openBtn = h('button', { disabled: true, title: 'Opens the PDF in your PDF viewer, to print from its own print dialog', onclick: async () => { await window.api.print.open(built.pdf, name); done(false); } }, 'Open in PDF viewer...');

    // What the chosen printer can do decides which options are offered.
    function sync() {
      const p = printer();
      const canDuplex = p.duplex !== false;
      duplex.disabled = !canDuplex || o.booklet;
      duplex.value = !canDuplex ? 'simplex' : o.booklet ? 'shortEdge' : o.duplex;
      color.disabled = p.color === false;
      color.value = p.color === false || !o.color ? 'mono' : 'color';
      view.classList.toggle('mono', color.value === 'mono');
      [saveBtn, openBtn].forEach((b) => (b.disabled = !ready));
      printBtn.disabled = !ready || sending || !p.name;
      collateLbl.style.display = o.copies > 1 && p.collate !== false ? '' : 'none';
      const warn = [];
      if (p.offline) warn.push('Windows says this printer is offline.');
      if (o.booklet && !canDuplex) warn.push('This printer cannot print on both sides. Print the booklet on one that can, or save it as a PDF.');
      note.textContent = warn.join(' ');
      note.className = warn.length ? 'note warn' : 'note';
      if (built) {
        const n = built.numbers.length;
        const sheets = o.booklet ? Math.ceil(n / 4) : duplex.value === 'simplex' ? n : Math.ceil(n / 2);
        summary.textContent = `${n} ${n === 1 ? 'page' : 'pages'} on ${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}${o.copies > 1 ? `, ${o.copies} copies` : ''}${o.booklet ? '. Fold the stack in half.' : ''}`;
      }
    }

    async function rebuild() {
      const my = ++seq;
      const chosen = parsePages(pages.value, built ? built.total : Infinity);
      pages.classList.toggle('bad', chosen === null);
      if (chosen === null) {
        ready = false;
        return sync();
      }
      ready = false;
      sync();
      view.classList.add('busy');
      try {
        const r = await window.api.print.build(html, { booklet: o.booklet, pages: chosen, label: !!sheet });
        if (my !== seq) return;
        built = r;
        pagesOf.textContent = `of ${r.total}`;
        await drawPreview(r.pdf, my);
        if (my !== seq) return;
        ready = true;
      } catch (e) {
        if (my === seq) view.replaceChildren(h('div', { class: 'note warn' }, 'Could not lay out the document: ' + e.message));
      } finally {
        if (my === seq) view.classList.remove('busy');
      }
      sync();
    }

    // Pages are drawn when they scroll into view, so long documents open quickly.
    async function drawPreview(bytes, my) {
      const lib = await loadPdfjs();
      const doc = await lib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
      if (my !== seq) return;
      const width = Math.min(view.clientWidth - 40, o.booklet || (sheet && sheet.landscape) ? 820 : 560);
      const seen = new IntersectionObserver((entries) => entries.forEach(async (en) => {
        if (!en.isIntersecting) return;
        seen.unobserve(en.target);
        const c = en.target;
        const page = await doc.getPage(+c.dataset.n);
        const vp = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * devicePixelRatio });
        c.width = vp.width;
        c.height = vp.height;
        page.render({ canvasContext: c.getContext('2d'), viewport: vp });
      }), { root: view, rootMargin: '400px' });
      const figs = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
        const c = h('canvas', { dataset: { n: i }, style: `width:${width}px;height:${Math.round((vp.height * width) / vp.width)}px` });
        const label = o.booklet ? `Sheet ${Math.ceil(i / 2)}, ${i % 2 ? 'front' : 'back'}` : `Page ${built.numbers[i - 1]}`;
        figs.push(h('figure', null, c, h('figcaption', null, label)));
        seen.observe(c);
      }
      view.replaceChildren(...figs);
    }

    async function run() {
      const p = printer();
      if (!p.name) return;
      Object.assign(last, { printer: o.printer, copies: o.copies, collate: o.collate, duplex: o.booklet ? last.duplex : o.duplex, color: o.color, booklet: sheet ? last.booklet : o.booklet });
      sending = true;
      sync();
      status('Sending to ' + p.label + '...');
      const r = await window.api.print.run(built.pdf, {
        deviceName: p.name, copies: o.copies, collate: o.collate, color: color.value === 'color', duplexMode: duplex.value, landscape: sheet ? sheet.landscape : o.booklet, pageSize: sheet && sheet.pageSize,
      });
      if (r.ok) {
        status('Sent to ' + p.label);
        done(true);
      } else {
        sending = false;
        sync();
        note.textContent = r.reason === 'cancelled' || /cancel/i.test(r.reason || '') ? 'Printing was cancelled.' : 'The printer did not take the job' + (r.reason ? ': ' + r.reason : '.');
        note.className = 'note warn';
        status('');
      }
    }

    const dlg = h('dialog', { class: 'printdlg' },
      h('div', { class: 'dh' }, 'Print'),
      h('div', { class: 'pbody' },
        view,
        h('div', { class: 'popts' },
          h('div', { class: 'form' },
            h('label', null, 'Printer'), printerSel,
            h('label', null, 'Copies'), h('div', { class: 'row' }, copies, collateLbl),
            h('label', null, 'Pages'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, pages, pagesOf),
            sheet ? null : h('label', null, 'Layout'), sheet ? null : layout,
            h('label', null, 'Sides'), duplex,
            h('label', null, 'Colour'), color),
          summary, note)),
      h('div', { class: 'df' }, openBtn, h('span', { class: 'spacer' }), saveBtn, h('button', { onclick: () => done(false) }, 'Cancel'), printBtn));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
    document.body.appendChild(dlg);
    dlg.showModal();
    sync();
    rebuild();

    window.api.print.printers().then((list) => {
      printers = list;
      if (!printers.some((p) => p.name === o.printer)) o.printer = (printers[0] || {}).name || null;
      printerSel.replaceChildren(...(printers.length
        ? printers.map((p) => h('option', { value: p.name, selected: p.name === o.printer }, p.label + (p.offline ? ' (offline)' : '')))
        : [h('option', { value: '' }, 'No printers found')]));
      printerSel.disabled = !printers.length;
      sync();
    });
  });
}
