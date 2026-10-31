import * as store from '../lib/store.js';
import { h, icon, tabs, uid } from '../lib/ui.js';
import { SECTIONS, buildDocument } from '../lib/printdoc.js';
import { printDialog, savePdf } from '../lib/printdialog.js';
import { GUIDES, CATEGORIES } from '../data/firstaid.js';
import { SIZES, SYMBOL_NAMES, PRESETS, newLabel, sheetFor, buildLabels } from '../lib/labeldoc.js';

const state = {
  sections: new Set(['summary', 'contacts', 'people', 'medications', 'locations', 'utilities', 'meeting', 'scenarios', 'radio', 'checklists', 'firstaid']),
  checklists: null, // null = all
  guides: null,
  pageBreaks: false,
  cover: true,
};
let tab = 'plan';
let activeLabel = null;

export function render(root, params) {
  if (params.tab) tab = params.tab;
  const pane = h('div', { style: 'flex:1;display:flex;flex-direction:column;min-height:0' });
  root.replaceChildren(tabs([{ id: 'plan', label: 'Plan' }, { id: 'labels', label: 'Box labels' }], tab, (id) => { tab = id; render(root, {}); }), pane);
  (tab === 'labels' ? labels : plan)(pane, params);
}

function plan(root, params) {
  if (params.checklist) {
    state.sections = new Set(['checklists']);
    state.checklists = new Set([params.checklist]);
  }
  if (params.guides) {
    state.sections = new Set(['firstaid']);
    state.guides = new Set(params.guides);
  }
  if (params.sections) state.sections = new Set(params.sections);

  const lists = store.get('checklists');
  if (!state.checklists) state.checklists = new Set(lists.map((l) => l.id));
  if (!state.guides) state.guides = new Set(GUIDES.map((g) => g.id));

  const frame = h('iframe', { class: 'preview', sandbox: 'allow-same-origin' });
  let t;
  const refresh = () => {
    clearTimeout(t);
    t = setTimeout(() => (frame.srcdoc = html()), 150);
  };
  const html = () => buildDocument([...state.sections], { checklistIds: [...state.checklists], guideIds: [...state.guides], pageBreaks: state.pageBreaks, cover: state.cover });

  const chk = (set, id, label, after) => h('label', { class: 'chk', style: 'display:flex;padding:2px 0' },
    h('input', { type: 'checkbox', checked: set.has(id), onchange: (e) => { e.target.checked ? set.add(id) : set.delete(id); refresh(); after && after(); } }), label);

  const guideBox = h('div', { style: 'padding-left:18px' });
  const drawGuides = () => guideBox.replaceChildren(
    h('div', { class: 'row', style: 'margin:3px 0' },
      h('button', { class: 'small', onclick: () => { GUIDES.forEach((g) => state.guides.add(g.id)); drawGuides(); refresh(); } }, 'All'),
      h('button', { class: 'small', onclick: () => { state.guides.clear(); drawGuides(); refresh(); } }, 'None'),
      h('button', { class: 'small', onclick: () => { state.guides = new Set(GUIDES.filter((g) => g.sev === 'call999').map((g) => g.id)); drawGuides(); refresh(); } }, 'Life-threatening only')),
    ...CATEGORIES.flatMap((c) => [
      h('div', { class: 'muted small', style: 'margin-top:4px' }, c),
      ...GUIDES.filter((g) => g.cat === c).map((g) => chk(state.guides, g.id, g.title)),
    ]));
  drawGuides();

  const side = h('div', { class: 'side', style: 'width:320px' },
    h('div', { class: 'panel', style: 'flex:1;display:flex;flex-direction:column;min-height:0;margin:0' },
      h('div', { class: 'ph' }, h('h3', null, 'Sections'), h('span', { class: 'spacer' }),
        h('button', { class: 'small', onclick: () => { SECTIONS.forEach((s) => state.sections.add(s.id)); plan(root, {}); } }, 'Print all'),
        h('button', { class: 'small', onclick: () => { state.sections.clear(); plan(root, {}); } }, 'Clear')),
      h('div', { class: 'pb scroll', style: 'flex:1' },
        SECTIONS.map((s) => [
          chk(state.sections, s.id, s.label),
          s.id === 'checklists' ? h('div', { style: 'padding-left:18px' }, lists.map((l) => chk(state.checklists, l.id, l.name))) : null,
          s.id === 'firstaid' ? guideBox : null,
        ]),
        h('hr'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: state.cover, onchange: (e) => { state.cover = e.target.checked; refresh(); } }), 'Cover page'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: state.pageBreaks, onchange: (e) => { state.pageBreaks = e.target.checked; refresh(); } }), 'Start each section on a new page'))));

  const body = h('div', { class: 'body' },
    h('div', { class: 'row', style: 'margin-bottom:6px' },
      h('button', { class: 'primary', onclick: () => printDialog(html()) }, icon('printer'), 'Print...'),
      h('button', { onclick: () => savePdf(html(), 'Emergency plan') }, 'Save as PDF...'),
      h('span', { class: 'muted' }, 'Preview below is A4. Printed copies work when there is no power or internet.')),
    frame);

  root.replaceChildren(h('div', { class: 'split' }, side, body));
  refresh();
}

// Box labels and signs. Sheet settings apply to every label; the labels are printed in list order.
function labels(root) {
  const cfg = store.get('labels');
  if (!cfg.items.length) cfg.items.push(newLabel(uid()));
  if (!cfg.items.some((l) => l.id === activeLabel)) activeLabel = cfg.items[0].id;

  const frame = h('iframe', { class: 'preview', sandbox: 'allow-same-origin' });
  const info = h('span', { class: 'muted' });
  let t;
  const refresh = () => {
    store.save('labels');
    const s = sheetFor(cfg);
    const n = cfg.items.length;
    const sheets = Math.ceil(n / s.per);
    info.textContent = `${n} ${n === 1 ? 'label' : 'labels'} on ${sheets} ${s.pageSize} ${sheets === 1 ? 'sheet' : 'sheets'}${s.per > 1 ? '. Cut along the dashed lines.' : ''}`;
    clearTimeout(t);
    t = setTimeout(() => (frame.srcdoc = buildLabels(cfg)), 150);
  };
  const sheet = () => { const s = sheetFor(cfg); return { landscape: s.landscape, pageSize: s.pageSize }; };

  const select = (options, value, onchange) => {
    const el = h('select', { onchange: (e) => onchange(e.target.value) }, options.map(([v, label]) => h('option', { value: v }, label)));
    el.value = value;
    return el;
  };
  const field = (l, k, props = {}) => h(props.rows ? 'textarea' : 'input', { type: 'text', ...props, value: l[k] || '', oninput: (e) => { l[k] = e.target.value; refresh(); if (k !== 'items') drawList(); } });

  const listEl = h('div', { class: 'list', style: 'flex:none;max-height:150px' });
  const editor = h('div', { style: 'margin-top:8px' });
  const drawList = () => listEl.replaceChildren(...cfg.items.map((l) => h('div', { class: 'li' + (l.id === activeLabel ? ' active' : ''), onclick: () => { activeLabel = l.id; drawList(); drawEditor(); } },
    h('span', null, l.heading || 'Untitled'), l.sub ? h('span', { class: 'sub' }, l.sub) : null)));
  const changed = () => { drawList(); drawEditor(); refresh(); };

  function drawEditor() {
    const l = cfg.items.find((x) => x.id === activeLabel);
    const i = cfg.items.indexOf(l);
    const plus = (months) => {
      const d = new Date(l.packed || Date.now());
      d.setMonth(d.getMonth() + months);
      l.check = d.toISOString().slice(0, 10);
      changed();
    };
    const dateIn = (k) => h('input', { type: 'date', value: l[k] || '', title: 'Leave empty to write it in by hand', onchange: (e) => { l[k] = e.target.value; refresh(); } });
    const move = (to) => { cfg.items.splice(to, 0, ...cfg.items.splice(i, 1)); changed(); };
    editor.replaceChildren(h('div', { class: 'form', style: 'grid-template-columns:70px 1fr' },
      h('label', null, 'Start from'), select([['', 'Choose...'], ...PRESETS.map((p, n) => [n, p.heading])], '', (v) => { Object.assign(l, PRESETS[v]); changed(); }),
      h('label', null, 'Heading'), field(l, 'heading'),
      h('label', null, 'Under it'), field(l, 'sub', { placeholder: 'e.g. Under the stairs' }),
      h('label', null, 'Symbol'), select(SYMBOL_NAMES, l.symbol, (v) => { l.symbol = v; refresh(); }),
      h('label', { style: 'align-self:start;padding-top:3px' }, 'Contents'), field(l, 'items', { rows: 4, placeholder: 'One item per line. Leave empty for a sign.' }),
      h('label', null, 'Dates'), h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: l.dates, onchange: (e) => { l.dates = e.target.checked; changed(); } }), 'Packed and check by'),
      l.dates ? [
        h('label', null, 'Packed'), dateIn('packed'),
        h('label', null, 'Check by'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, dateIn('check'),
          h('button', { class: 'small', onclick: () => plus(6) }, '+6 mo'), h('button', { class: 'small', onclick: () => plus(12) }, '+1 yr')),
      ] : null),
    h('div', { class: 'row', style: 'margin-top:6px' },
      h('button', { class: 'small', onclick: () => { const c = { ...structuredClone(l), id: uid() }; cfg.items.splice(i + 1, 0, c); activeLabel = c.id; changed(); } }, 'Duplicate'),
      h('button', { class: 'small', title: 'Move up', disabled: i === 0, onclick: () => move(i - 1) }, icon('chevron-up')),
      h('button', { class: 'small', title: 'Move down', disabled: i === cfg.items.length - 1, onclick: () => move(i + 1) }, icon('chevron-down')),
      h('span', { class: 'spacer' }),
      h('button', { class: 'small', disabled: cfg.items.length < 2, onclick: () => { cfg.items.splice(i, 1); activeLabel = cfg.items[Math.max(0, i - 1)].id; changed(); } }, icon('delete-outline'), 'Remove')));
  }

  const perSheet = (k) => (k === 'A3' || k === 'A4' ? k : `${k} (${sheetFor({ size: k }).per} per A4)`);
  const side = h('div', { class: 'side', style: 'width:340px' },
    h('div', { class: 'panel', style: 'flex:1;display:flex;flex-direction:column;min-height:0;margin:0' },
      h('div', { class: 'ph' }, h('h3', null, 'Labels'), h('span', { class: 'spacer' }),
        h('button', { class: 'small', onclick: () => { const l = newLabel(uid()); cfg.items.push(l); activeLabel = l.id; changed(); } }, icon('plus'), 'Add')),
      h('div', { class: 'pb scroll', style: 'flex:1' },
        listEl,
        editor,
        h('hr'),
        h('div', { class: 'form', style: 'grid-template-columns:70px 1fr' },
          h('label', null, 'Size'), select(Object.keys(SIZES).map((k) => [k, perSheet(k)]), cfg.size, (v) => { cfg.size = v; refresh(); }),
          h('label', null, 'Turn'), select([['1', 'Landscape'], ['', 'Portrait']], cfg.landscape ? '1' : '', (v) => { cfg.landscape = !!v; refresh(); }),
          h('label', null, 'Ink'), select([['colour', 'Red and black'], ['mono', 'Black only']], cfg.ink, (v) => { cfg.ink = v; refresh(); }),
          h('span'), h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: cfg.hex, onchange: (e) => { cfg.hex = e.target.checked; refresh(); } }), 'Hexagon pattern')))));

  const body = h('div', { class: 'body' },
    h('div', { class: 'row', style: 'margin-bottom:6px' },
      h('button', { class: 'primary', onclick: () => printDialog(buildLabels(cfg), { name: 'Box labels', sheet: sheet() }) }, icon('printer'), 'Print...'),
      h('button', { onclick: () => savePdf(buildLabels(cfg), 'Box labels', sheet()) }, 'Save as PDF...'),
      info),
    frame);

  drawList();
  drawEditor();
  root.replaceChildren(h('div', { class: 'split' }, side, body));
  refresh();
}
