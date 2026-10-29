import * as store from '../lib/store.js';
import { h, panel, editTable, bar, uid, confirmBox, chart, COLORS, promptForm, icon } from '../lib/ui.js';

let active = null;

export function progress(cl) {
  const n = cl.items.length;
  const d = cl.items.filter((i) => i.done).length;
  return { n, d, frac: n ? d / n : 0 };
}

export function render(root) {
  const lists = store.get('checklists');
  if (!lists.find((l) => l.id === active)) active = lists[0] && lists[0].id;
  let ch;
  const chartEl = h('div', { class: 'chartbox', style: 'height:160px' });

  const draw = () => {
    const cl = lists.find((l) => l.id === active);
    const side = h('div', { class: 'side' },
      h('div', { class: 'list' },
        lists.map((l) => {
          const p = progress(l);
          return h('div', { class: 'li' + (l.id === active ? ' active' : ''), style: 'flex-direction:column;align-items:stretch', onclick: () => { active = l.id; draw(); } },
            h('div', { class: 'row' }, h('span', null, l.name), h('span', { class: 'spacer' }), h('span', { class: 'sub' }, `${p.d}/${p.n}`)),
            bar(p.frac, p.frac === 1 ? 'ok' : p.frac >= 0.5 ? 'warn' : 'bad'));
        })),
      h('div', { class: 'row', style: 'margin-top:6px' },
        h('button', { onclick: async () => {
          const v = await promptForm('New checklist', [{ key: 'name', label: 'Name' }], 'Create');
          if (!v || !v.name) return;
          const l = { id: uid(), name: v.name, items: [] };
          lists.push(l);
          active = l.id;
          store.save('checklists');
          draw();
        } }, icon('plus'), 'New checklist')),
      panel('Completion', chartEl));

    const body = h('div', { class: 'body' });
    if (cl) {
      const p = progress(cl);
      const ptext = h('b', null, `${p.d} of ${p.n} done (${Math.round(p.frac * 100)}%)`);
      const tbl = editTable([
        { key: 'done', label: 'Done', type: 'checkbox', width: '44px' },
        { key: 'text', label: 'Item', type: 'textarea' },
        { key: 'qty', label: 'Qty / detail', width: '120px' },
        { key: 'note', label: 'Notes', width: '200px' },
      ], cl.items, () => {
        store.save('checklists');
        const q = progress(cl);
        ptext.textContent = `${q.d} of ${q.n} done (${Math.round(q.frac * 100)}%)`;
        drawChart();
      }, { addLabel: 'Add item', newRow: () => ({ done: false, text: '' }), rowClass: (r) => (r.done ? '' : '') });
      body.append(
        panel(cl.name, h('div', { class: 'stack' },
          h('div', { class: 'row' },
            h('input', { value: cl.name, style: 'width:320px', oninput: (e) => { cl.name = e.target.value; store.save('checklists'); } }),
            ptext,
            h('span', { class: 'spacer' }),
            h('button', { onclick: () => { cl.items.forEach((i) => (i.done = true)); store.save('checklists'); draw(); } }, icon('check-all'), 'Tick all'),
            h('button', { onclick: async () => { if (await confirmBox('Untick every item in this checklist?', 'Reset')) { cl.items.forEach((i) => (i.done = false)); store.save('checklists'); draw(); } } }, icon('restore'), 'Reset'),
            h('button', { onclick: () => window.go('print', { checklist: cl.id }) }, icon('printer'), 'Print'),
            h('button', { class: 'danger', onclick: async () => { if (await confirmBox(`Delete checklist "${cl.name}"?`, 'Delete', true)) { lists.splice(lists.indexOf(cl), 1); store.save('checklists'); active = null; draw(); } } }, icon('delete-outline'), 'Delete')),
          tbl)));
    }
    root.replaceChildren(h('div', { class: 'split', style: 'min-height:560px' }, side, body));
    drawChart();
  };

  const drawChart = () => {
    if (ch) ch.destroy();
    ch = chart(chartEl, {
      type: 'bar',
      data: {
        labels: lists.map((l) => (l.name.length > 18 ? l.name.slice(0, 17) + '.' : l.name)),
        datasets: [{ data: lists.map((l) => Math.round(progress(l).frac * 100)), backgroundColor: lists.map((l) => { const f = progress(l).frac; return f === 1 ? COLORS.green : f >= 0.5 ? COLORS.amber : COLORS.red; }) }],
      },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } } },
    });
  };

  draw();
  return () => ch && ch.destroy();
}
