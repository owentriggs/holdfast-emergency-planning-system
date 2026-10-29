import * as store from '../lib/store.js';
import { h, panel, editTable, chart, daysUntil, table, fmtDate, COLORS } from '../lib/ui.js';
import { suggestionsFor } from '../data/defaults.js';

export const CATEGORIES = ['Water', 'Food', 'Medical', 'Hygiene', 'Light and power', 'Communication', 'Warmth', 'Money and documents', 'Baby', 'Pets', 'Tools', 'Other'];

// Days of supply for consumables with a per-person-per-day rate.
export function coverageDays(row, people) {
  if (!row.perPersonDay || row.qty == null) return null;
  return row.qty / (people * row.perPersonDay);
}

export function coverageByCategory() {
  const people = store.householdSize();
  const out = {};
  for (const r of store.get('supplies')) {
    const d = coverageDays(r, people);
    if (d == null) continue;
    // Food items each add person-days; water rows are separate needs (drinking vs washing), so use the lowest.
    if (r.category === 'Food') out.Food = (out.Food || 0) + d;
    else out[r.category] = out[r.category] == null ? d : Math.min(out[r.category], d);
  }
  return out;
}

// Litres of drinking water: every Water row except ones named as being for washing, cooking, cleaning or flushing.
// Used by both this page and the dashboard so they always agree.
export function drinkingWater() {
  const st = store.settings();
  const litres = store.get('supplies')
    .filter((r) => r.category === 'Water' && !/wash|cook|clean|flush|toilet/i.test(r.item || ''))
    .reduce((a, r) => a + (Number(r.qty) || 0), 0);
  const need = store.householdSize() * st.waterPerPersonDay * st.targetDays;
  return { litres, need, days: litres / (store.householdSize() * st.waterPerPersonDay) };
}

export function expiringItems(withinDays = 90) {
  const rows = [];
  for (const [key, src] of [['supplies', 'Supplies'], ['firstAidKit', 'First aid kit']])
    for (const r of store.get(key)) {
      const d = daysUntil(r.expiry);
      if (d != null && d <= withinDays) rows.push({ source: src, item: r.item, expiry: r.expiry, days: d, location: r.location });
    }
  return rows.sort((a, b) => a.days - b.days);
}

export function render(root) {
  const rows = store.get('supplies');
  const st = store.settings();
  const expEl = h('div', { class: 'chartbox' });
  const expTable = h('div');
  const summary = h('div', { class: 'stats' });
  let expChart;

  const refresh = () => {
    const cov = coverageByCategory();
    const { litres: water, need: waterNeed } = drinkingWater();
    summary.replaceChildren(
      h('div', { class: 'stat ' + (water >= waterNeed ? '' : 'warn') }, h('div', { class: 'v' }, `${water} / ${waterNeed} L`), h('div', { class: 'l' }, `Drinking water for ${st.targetDays} days`)),
      ...Object.entries(cov).map(([k, v]) => h('div', { class: 'stat ' + (v >= st.targetDays ? '' : 'warn') }, h('div', { class: 'v' }, v.toFixed(1) + ' d'), h('div', { class: 'l' }, k + ' coverage'))),
      h('div', { class: 'stat ' + (expiringItems(30).length ? 'warn' : '') }, h('div', { class: 'v' }, expiringItems(30).length), h('div', { class: 'l' }, 'Expiring within 30 days')));

    // Expiry by month for the next 12 months.
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) months.push(new Date(now.getFullYear(), now.getMonth() + i, 1));
    const counts = months.map(() => 0);
    let expired = 0;
    for (const key of ['supplies', 'firstAidKit']) for (const r of store.get(key)) {
      if (!r.expiry) continue;
      const d = new Date(r.expiry);
      if (d < new Date(now.getFullYear(), now.getMonth(), 1)) { expired++; continue; }
      const idx = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
      if (idx >= 0 && idx < 12) counts[idx]++;
    }
    if (expChart) expChart.destroy();
    expChart = chart(expEl, {
      type: 'bar',
      data: { labels: ['Expired', ...months.map((m) => m.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }))], datasets: [{ label: 'Items expiring', data: [expired, ...counts], backgroundColor: [COLORS.red, ...counts.map((_, i) => (i < 1 ? COLORS.amber : COLORS.blue))] }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
    });

    expTable.replaceChildren(table([
      { label: 'Item', key: 'item' },
      { label: 'Source', key: 'source' },
      { label: 'Expiry', get: (r) => fmtDate(r.expiry) },
      { label: 'Days', key: 'days', num: true },
      { label: 'Location', key: 'location' },
    ], expiringItems(90), { rowClass: (r) => (r.days < 0 ? 'bad' : r.days < 30 ? 'warn' : ''), emptyText: 'Nothing expiring in the next 90 days', maxHeight: '220px' }));
  };

  let t;
  const onChange = () => { store.save('supplies'); clearTimeout(t); t = setTimeout(refresh, 400); };
  const people = () => store.householdSize();

  root.append(
    summary,
    h('div', { style: 'height:10px' }),
    panel('Stock', editTable([
      { key: 'category', label: 'Category', type: 'select', options: CATEGORIES, width: '140px' },
      { key: 'item', label: 'Item', width: '240px' },
      { key: 'qty', label: 'Qty', type: 'number', width: '70px' },
      { key: 'unit', label: 'Unit', width: '90px', list: 'units' },
      { key: 'perPersonDay', label: 'Use / person / day', type: 'number', width: '110px', title: 'Leave blank for non-consumables. For food, record Qty in person-days and use 1 here.' },
      { key: 'days', label: 'Days', type: 'ro', num: true, width: '60px', title: 'Qty / (people x use per person per day). Target days are in Settings.', compute: (r) => { const d = coverageDays(r, people()); return d == null ? '' : d.toFixed(1); } },
      { key: 'expiry', label: 'Expiry', type: 'date', width: '125px' },
      { key: 'location', label: 'Stored at', width: '130px' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ], rows, onChange, {
      addLabel: 'Add item',
      suggestions: suggestionsFor('supplies'),
      emptyText: 'No supplies recorded yet. The suggestions are the GOV.UK Be Ready kit list.',
      newRow: () => ({ category: 'Other', qty: 0 }),
      rowClass: (r) => { const d = daysUntil(r.expiry); return d != null && d < 0 ? 'bad' : d != null && d < 30 ? 'warn' : ''; },
    })),
    h('datalist', { id: 'units' }, ['litres', 'person-days', 'each', 'packs', 'tins', 'bottles', 'days', 'kit', 'GBP'].map((u) => h('option', { value: u }))),
    h('div', { class: 'grid g2' }, panel('Expiring within 90 days', expTable), panel('Expiry by month', expEl)));
  refresh();
  return () => { expChart && expChart.destroy(); };
}
