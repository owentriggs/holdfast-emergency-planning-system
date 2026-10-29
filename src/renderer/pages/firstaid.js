import * as store from '../lib/store.js';
import { h, panel, tabs, editTable, daysUntil, bar, icon } from '../lib/ui.js';
import { GUIDES, CATEGORIES, SEVERITY, SOURCES } from '../data/firstaid.js';
import { suggestionsFor } from '../data/defaults.js';

let tab = 'guides';
let current = 'primary';
let query = '';
let sevFilter = '';
const selected = new Set();

export function render(root) {
  const draw = () => {
    root.replaceChildren(
      tabs([{ id: 'guides', label: 'Guides', count: GUIDES.length }, { id: 'kit', label: 'First Aid Kit Inventory', count: store.get('firstAidKit').length }], tab, (id) => { tab = id; draw(); }),
      tab === 'guides' ? guides() : kit());
  };
  draw();
}

function guides() {
  const listEl = h('div', { class: 'list' });
  const detail = h('div', { class: 'guide' });
  const selCount = h('span');

  const drawList = () => {
    const q = query.toLowerCase();
    const match = (g) => (!sevFilter || g.sev === sevFilter) && (!q || [g.title, g.summary, ...g.steps].join(' ').toLowerCase().includes(q));
    listEl.replaceChildren(...CATEGORIES.flatMap((c) => {
      const gs = GUIDES.filter((g) => g.cat === c && match(g));
      if (!gs.length) return [];
      return [h('div', { class: 'lihead' }, c), ...gs.map((g) => h('div', { class: 'li' + (g.id === current ? ' active' : ''), onclick: () => { current = g.id; drawList(); drawDetail(); } },
        h('input', { type: 'checkbox', checked: selected.has(g.id), title: 'Select for printing', onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? selected.add(g.id) : selected.delete(g.id); selCount.textContent = selected.size; } }),
        h('span', null, g.title), h('span', { class: 'spacer' }),
        g.sev === 'call999' ? h('span', { class: 'pill bad', style: 'font-size:10px' }, '999') : null))];
    }));
    if (!listEl.children.length) listEl.append(h('div', { class: 'li muted' }, 'No matching guides'));
  };

  const drawDetail = () => {
    const g = GUIDES.find((x) => x.id === current) || GUIDES[0];
    const sev = SEVERITY[g.sev];
    detail.replaceChildren(...[
      h('div', { class: 'row' }, h('h2', null, g.title), h('span', { class: 'pill ' + sev.cls }, sev.label), h('span', { class: 'spacer' }),
        h('button', { onclick: () => window.go('print', { guides: [g.id] }) }, 'Print this guide')),
      h('div', { class: 'muted', style: 'font-size:13px;margin:4px 0 8px' }, g.summary),
      g.sev === 'call999' ? h('div', { class: 'callout' }, h('b', null, 'Life-threatening: call 999 (or 112). '), 'Put the phone on speaker so you can keep helping. The call handler will guide you.') : null,
      h('h3', null, 'What to do'),
      h('ol', { class: 'steps' }, g.steps.map((s) => h('li', { html: s }))),
      g.call && g.call.length ? h('div', { class: 'callout amber' }, h('b', null, 'When to get help'), h('ul', null, g.call.map((s) => h('li', null, s)))) : null,
      g.dont && g.dont.length ? h('div', { class: 'sect' }, h('h3', null, 'Do not'), h('ul', null, g.dont.map((s) => h('li', null, s)))) : null,
      g.notes ? h('div', { class: 'callout blue' }, g.notes) : null,
      h('div', { class: 'src' }, 'Sources: ', g.src.map((s, i) => [i ? ', ' : '', h('a', { href: SOURCES[s].url, target: '_blank' }, SOURCES[s].name)]),
        '. Summary for reference only; not a substitute for first aid training. Cache the source pages in the Library for full detail.'),
    ].filter(Boolean));
  };

  drawList();
  drawDetail();
  selCount.textContent = selected.size;

  return h('div', { class: 'split', style: 'height:calc(100vh - 150px)' },
    h('div', { class: 'side', style: 'width:300px' },
      h('div', { class: 'row', style: 'margin-bottom:6px' },
        h('input', { type: 'search', placeholder: 'Search guides...', value: query, style: 'flex:1', oninput: (e) => { query = e.target.value; drawList(); } }),
        h('select', { onchange: (e) => { sevFilter = e.target.value; drawList(); } },
          h('option', { value: '' }, 'All'), Object.entries(SEVERITY).map(([k, v]) => h('option', { value: k, selected: sevFilter === k }, v.label)))),
      listEl,
      h('div', { class: 'row', style: 'margin-top:6px' },
        h('button', { title: 'Tick guides in the list to print them as a set', onclick: () => selected.size && window.go('print', { guides: [...selected] }) }, 'Print selected (', selCount, ')'),
        h('button', { onclick: () => window.go('print', { guides: GUIDES.map((g) => g.id) }) }, 'Print all'),
        h('button', { class: 'small', onclick: () => { selected.clear(); drawList(); selCount.textContent = 0; } }, 'Clear'))),
    h('div', { class: 'body' },
      h('div', { class: 'row', style: 'margin-bottom:6px' },
        h('span', { class: 'big999' }, '999 / 112'), h('span', { class: 'muted' }, 'life-threatening'),
        h('span', { style: 'width:20px' }), h('b', { style: 'font-size:16px' }, '111'), h('span', { class: 'muted' }, 'urgent, not life-threatening'),
        h('span', { class: 'spacer' })),
      detail));
}

function kit() {
  const rows = store.get('firstAidKit');
  const summary = h('div', { class: 'stats' });
  const refresh = () => {
    const short = rows.filter((r) => r.target && (r.qty || 0) < r.target).length;
    const expired = rows.filter((r) => daysUntil(r.expiry) != null && daysUntil(r.expiry) < 0).length;
    const soon = rows.filter((r) => { const d = daysUntil(r.expiry); return d != null && d >= 0 && d <= 60; }).length;
    const complete = rows.filter((r) => r.target).length ? rows.filter((r) => r.target && (r.qty || 0) >= r.target).length / rows.filter((r) => r.target).length : 0;
    summary.replaceChildren(
      h('div', { class: 'stat' }, h('div', { class: 'v' }, Math.round(complete * 100) + '%'), h('div', { class: 'l' }, 'Kit complete'), bar(complete)),
      h('div', { class: 'stat ' + (short ? 'warn' : '') }, h('div', { class: 'v' }, short), h('div', { class: 'l' }, 'Items below target')),
      h('div', { class: 'stat ' + (expired ? 'bad' : '') }, h('div', { class: 'v' }, expired), h('div', { class: 'l' }, 'Expired')),
      h('div', { class: 'stat ' + (soon ? 'warn' : '') }, h('div', { class: 'v' }, soon), h('div', { class: 'l' }, 'Expiring within 60 days')));
  };
  refresh();
  return h('div', { class: 'stack' },
    summary,
    panel('Kit contents', editTable([
      { key: 'item', label: 'Item', width: '280px' },
      { key: 'qty', label: 'Have', type: 'number', width: '70px' },
      { key: 'target', label: 'Target', type: 'number', width: '70px' },
      { key: 'status', label: 'Status', type: 'ro', width: '90px', compute: (r) => (!r.target ? '' : (r.qty || 0) >= r.target ? 'OK' : `Need ${r.target - (r.qty || 0)}`) },
      { key: 'expiry', label: 'Expiry', type: 'date', width: '125px' },
      { key: 'location', label: 'Location', width: '140px' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ], rows, () => { store.save('firstAidKit'); refresh(); }, {
      addLabel: 'Add item',
      suggestions: suggestionsFor('firstAidKit'),
      emptyText: 'Kit is empty. The suggestions are based on the NHS recommended home first aid kit. Check medicines suit each person.',
      rowClass: (r) => { const d = daysUntil(r.expiry); return d != null && d < 0 ? 'bad' : (d != null && d <= 60) || (r.target && (r.qty || 0) < r.target) ? 'warn' : ''; },
      toolbar: h('button', { onclick: () => window.go('print', { sections: ['kit'] }) }, 'Print inventory'),
    })));
}
