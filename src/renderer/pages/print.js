import * as store from '../lib/store.js';
import { h, icon } from '../lib/ui.js';
import { SECTIONS, buildDocument } from '../lib/printdoc.js';
import { printDialog, savePdf } from '../lib/printdialog.js';
import { GUIDES, CATEGORIES } from '../data/firstaid.js';

const state = {
  sections: new Set(['summary', 'contacts', 'people', 'medications', 'locations', 'utilities', 'meeting', 'scenarios', 'radio', 'checklists', 'firstaid']),
  checklists: null, // null = all
  guides: null,
  pageBreaks: false,
  cover: true,
};

export function render(root, params) {
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
        h('button', { class: 'small', onclick: () => { SECTIONS.forEach((s) => state.sections.add(s.id)); render(root, {}); } }, 'Print all'),
        h('button', { class: 'small', onclick: () => { state.sections.clear(); render(root, {}); } }, 'Clear')),
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
