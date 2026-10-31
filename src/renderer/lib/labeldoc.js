// Box labels and signs: one design per label, tiled onto A4 (or A3) sheets with cutting lines between them.
import { esc, fmtDate } from './ui.js';
import { hexField } from './hexfield.js';

// Portrait width and height in mm.
export const SIZES = { A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148], A7: [74, 105] };

// Drawn in white on a 24 x 24 grid, inside the hexagon badge. c: the badge colour, for marks cut out of the white.
const SYMBOLS = {
  kit: () => '<path d="M12 4.5 19.5 11v8.5h-15V11z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><rect x="10.8" y="10.6" width="2.4" height="7" fill="#fff"/><rect x="8.5" y="12.9" width="7" height="2.4" fill="#fff"/>',
  firstaid: () => '<rect x="9.4" y="4.5" width="5.2" height="15" fill="#fff"/><rect x="4.5" y="9.4" width="15" height="5.2" fill="#fff"/>',
  water: () => '<path d="M12 3.5C10 6.5 5.8 11 5.8 15a6.2 6.2 0 0 0 12.4 0c0-4-4.2-8.5-6.2-11.5z" fill="#fff"/>',
  food: () => '<path d="M6.5 3.5v5.8a2.2 2.2 0 0 0 1.6 2.1v9.1h2v-9.1a2.2 2.2 0 0 0 1.6-2.1V3.5h-1.3v5h-.9v-5H8.7v5h-.9v-5zM16 3.5c-1.9 1.3-2.6 4.3-2.6 7.6h2.1v9.4h2v-17z" fill="#fff"/>',
  power: () => '<path d="M13.6 3 6 13.4h5.1L9.9 21l8.1-10.6h-5.2z" fill="#fff"/>',
  documents: (c) => `<path d="M6.5 3.5h8l3.5 3.5v13.5H6.5z" fill="#fff"/><path d="M9 11h6.5M9 14h6.5M9 17h4.5" stroke="${c}" stroke-width="1.3"/>`,
  medication: (c) => `<rect x="3.6" y="8.6" width="16.8" height="6.8" rx="3.4" transform="rotate(-45 12 12)" fill="#fff"/><path d="M9.6 9.6l4.8 4.8" stroke="${c}" stroke-width="1.3"/>`,
  pets: () => '<circle cx="6.8" cy="10.4" r="1.9" fill="#fff"/><circle cx="10" cy="6.8" r="2" fill="#fff"/><circle cx="14" cy="6.8" r="2" fill="#fff"/><circle cx="17.2" cy="10.4" r="1.9" fill="#fff"/><ellipse cx="12" cy="15.6" rx="4.4" ry="3.7" fill="#fff"/>',
};
export const SYMBOL_NAMES = [['kit', 'Kit (house)'], ['firstaid', 'First aid'], ['water', 'Water'], ['food', 'Food'], ['power', 'Power and batteries'], ['documents', 'Documents'], ['medication', 'Medication'], ['pets', 'Pets'], ['', 'None']];

// "Start from" choices on the label editor.
export const PRESETS = [
  { heading: 'Emergency kit', symbol: 'kit' },
  { heading: 'Grab bag', symbol: 'kit' },
  { heading: 'First aid', symbol: 'firstaid' },
  { heading: 'Drinking water', symbol: 'water' },
  { heading: 'Emergency food', symbol: 'food' },
  { heading: 'Batteries', symbol: 'power' },
  { heading: 'Torches and power', symbol: 'power' },
  { heading: 'Important documents', symbol: 'documents' },
  { heading: 'Medication', symbol: 'medication' },
  { heading: 'Pet supplies', symbol: 'pets' },
];

export const newLabel = (id) => ({ id, heading: 'Emergency kit', sub: '', items: '', symbol: 'kit', dates: true, packed: new Date().toISOString().slice(0, 10), check: '' });

// The sheet the labels go on, and how many fit. A3 labels print on A3; everything else on A4, turned whichever way fits more.
export function sheetFor(o) {
  const [pw, ph] = SIZES[o.size] || SIZES.A5;
  const [lw, lh] = o.landscape ? [ph, pw] : [pw, ph];
  const [sw, sh] = o.size === 'A3' ? SIZES.A3 : SIZES.A4;
  const fit = (w, h) => ({ w, h, cols: Math.floor((w + 0.5) / lw), rows: Math.floor((h + 0.5) / lh) });
  const a = fit(sw, sh);
  const b = fit(sh, sw);
  const s = b.cols * b.rows > a.cols * a.rows || (b.cols * b.rows === a.cols * a.rows && o.landscape) ? b : a;
  return { ...s, lw, lh, per: s.cols * s.rows, landscape: s.w > s.h, pageSize: o.size === 'A3' ? 'A3' : 'A4' };
}

const CSS = (s, ink) => `
@font-face { font-family: 'Tektur'; src: url('app://assets/fonts/tektur-600.woff2') format('woff2'); font-weight: 600; }
@page { size: ${s.w}mm ${s.h}mm; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; color: #1b1b1b; }
.sheet { width: ${s.w}mm; height: ${s.h}mm; display: grid; grid-template-columns: repeat(${s.cols}, ${s.lw}mm); grid-auto-rows: ${s.lh}mm; align-content: start; overflow: hidden; break-after: page; }
.sheet:last-child { break-after: auto; }
.lbl { --u: ${Math.min(s.lw, s.lh) / 100}mm; position: relative; overflow: hidden; padding: calc(var(--u) * 7); display: flex; flex-direction: column; }
.cut .lbl { outline: 0.3pt dashed #b0b0b0; outline-offset: -0.15pt; }
.lbl svg.hex { position: absolute; right: 0; top: 0; }
.top { position: relative; display: flex; align-items: center; gap: calc(var(--u) * 4); }
.solo .top { margin: auto 0; }
.badge { flex: none; width: calc(var(--u) * 17); height: calc(var(--u) * 17); display: block; }
h1 { font-family: 'Tektur', 'Segoe UI', sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; line-height: 1; margin: 0; }
.sub { font-size: calc(var(--u) * 4.4); font-weight: 600; color: ${ink}; margin-top: calc(var(--u) * 1.6); }
ul { position: relative; list-style: none; margin: calc(var(--u) * 5) 0 0; padding: 0; font-size: calc(var(--u) * 3.9); line-height: 1.35; column-gap: calc(var(--u) * 6); }
li { break-inside: avoid; padding-left: calc(var(--u) * 3.6); position: relative; }
li::before { content: ''; position: absolute; left: 0; top: 0.42em; width: calc(var(--u) * 1.7); height: calc(var(--u) * 1.95); background: ${ink}; clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); }
.foot { position: relative; margin-top: auto; display: flex; gap: calc(var(--u) * 9); border-top: calc(var(--u) * 0.45) solid #1b1b1b; padding-top: calc(var(--u) * 2.4); }
.solo .foot { margin-top: 0; }
.foot span { display: block; font-size: calc(var(--u) * 2.7); font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #5f6368; }
.foot b { display: block; font-size: calc(var(--u) * 4.8); font-weight: 600; }
.foot b.blank { width: calc(var(--u) * 30); height: calc(var(--u) * 6.2); border-bottom: 0.6pt solid #8a8a8a; }
@media screen { body { background: #e4e4e4; padding: 8mm 0; } .sheet { background: #fff; margin: 0 auto 8mm; box-shadow: 0 1px 4px rgba(0,0,0,.3); } }
`;

const badge = (name, ink) => `<svg class="badge" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon points="22.39,6 22.39,18 12,24 1.61,18 1.61,6 12,0" fill="${ink}"/><g transform="translate(12 12) scale(.62) translate(-12 -12)">${SYMBOLS[name](ink)}</g></svg>`;

// Heading size in label units, so it fills the width without running off it. Long headings go onto two lines.
function heading(text, avail, max) {
  const t = String(text || '').trim().toUpperCase();
  const fit = (lines) => Math.min(max, avail / (Math.max(...lines.map((l) => l.length), 1) * 0.68));
  let lines = [t];
  const words = t.split(/\s+/);
  if (fit(lines) < max * 0.62 && words.length > 1) {
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const two = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      if (!best || fit(two) > fit(best)) best = two;
    }
    if (fit(best) > fit(lines)) lines = best;
  }
  return `<h1 style="font-size:calc(var(--u) * ${fit(lines).toFixed(2)})">${lines.map(esc).join('<br>')}</h1>`;
}

function label(l, s, o, ink, n) {
  const w = (s.lw / Math.min(s.lw, s.lh)) * 100; // label width in units
  const items = String(l.items || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const solo = !items.length;
  const cols = items.length > (w > 120 ? 4 : 9) ? 2 : 1;
  const date = (k, title) => `<div><span>${title}</span>${l[k] ? `<b>${esc(fmtDate(l[k]))}</b>` : '<b class="blank"></b>'}</div>`;
  const hex = o.hex ? hexField(s.lw * 0.36, s.lh, Math.min(s.lw, s.lh) * 0.07, { from: 'right', seed: 7 + n * 13, density: 0.2, mono: o.ink === 'mono' }) : '';
  return `<div class="lbl${solo ? ' solo' : ''}">${hex}
    <div class="top">${l.symbol && SYMBOLS[l.symbol] ? badge(l.symbol, ink) : ''}<div>${heading(l.heading, w - 14 - (l.symbol ? 21 : 0) - (o.hex ? 4 : 0), solo ? 20 : 14)}${l.sub ? `<div class="sub">${esc(l.sub)}</div>` : ''}</div></div>
    ${items.length ? `<ul style="column-count:${cols}">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${l.dates ? `<div class="foot">${date('packed', 'Packed')}${date('check', 'Check by')}</div>` : ''}
  </div>`;
}

// o: { size, landscape, ink: 'colour' | 'mono', hex, items: [label] }
export function buildLabels(o) {
  const s = sheetFor(o);
  const ink = o.ink === 'mono' ? '#1b1b1b' : '#b3261e';
  const all = o.items.map((l, i) => label(l, s, o, ink, i));
  const sheets = [];
  for (let i = 0; i < all.length; i += s.per) sheets.push(`<div class="sheet${s.per > 1 ? ' cut' : ''}">${all.slice(i, i + s.per).join('')}</div>`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Box labels</title><style>${CSS(s, ink)}</style></head><body>${sheets.join('')}</body></html>`;
}
