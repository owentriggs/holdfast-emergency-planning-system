import * as store from '../lib/store.js';
import { h, panel, table, bar, summary, fmtDate, daysUntil } from '../lib/ui.js';
import { coverageByCategory, expiringItems, drinkingWater } from './supplies.js';
import { progress } from './checklists.js';
import { WMO } from './weather.js';

function readiness(tilesCount) {
  const st = store.settings();
  const hh = store.get('household');
  const cov = coverageByCategory();
  const water = drinkingWater();
  const capped = (v) => Math.max(0, Math.min(1, v || 0));
  const contacts = store.get('contacts');
  const kit = store.get('firstAidKit').filter((r) => r.target);
  const lists = store.get('checklists');
  const lib = store.get('webcache');
  const log = store.get('reviewLog');
  const lastReview = log.filter((r) => r.type === 'Plan review' && r.date).map((r) => r.date).sort().pop();
  const reviewAge = lastReview ? -daysUntil(lastReview) : null;
  const backupAge = st.lastUsbBackup ? -daysUntil(st.lastUsbBackup.slice(0, 10)) : null;
  const locs = store.get('locations');

  return [
    { name: 'Household details', page: 'planner', params: { tab: 'household' }, next: 'Add your postcode and who lives here', score: (hh.postcode ? 0.3 : 0) + (hh.address ? 0.2 : 0) + (hh.people.length ? 0.5 : 0), detail: `${hh.people.length} people, ${hh.postcode || 'no postcode'}` },
    { name: 'Emergency contacts', page: 'contacts', next: 'Add two ICE or out-of-area contacts', score: capped(contacts.filter((c) => c.phone && (c.ice || c.category === 'Out-of-area contact')).length / 2), detail: `${contacts.filter((c) => c.phone).length} contacts with numbers, ${contacts.filter((c) => c.phone && (c.ice || c.category === 'Out-of-area contact')).length} ICE / out-of-area` },
    { name: 'Meeting points', page: 'planner', params: { tab: 'meeting' }, next: 'Set a meeting point near home and one further away', score: capped(store.get('meeting').filter((m) => m.name || m.address).length / 2), detail: `${store.get('meeting').filter((m) => m.name || m.address).length} set` },
    { name: 'Key locations recorded', page: 'planner', params: { tab: 'locations' }, next: 'Record where the stopcock, meters and kit are', score: locs.length ? locs.filter((l) => l.location).length / locs.length : 0, detail: `${locs.filter((l) => l.location).length} of ${locs.length}` },
    { name: 'Drinking water', page: 'supplies', next: 'Store more bottled water', score: capped(water.days / st.targetDays), detail: `${water.litres} of ${water.need} litres (${water.days.toFixed(1)} of ${st.targetDays} days)` },
    { name: 'Food', page: 'supplies', next: 'Add food in person-days', score: capped((cov.Food || 0) / st.targetDays), detail: `${(cov.Food || 0).toFixed(1)} of ${st.targetDays} days` },
    { name: 'First aid kit', page: 'firstaid', params: { tab: 'kit' }, next: 'Check the kit against its targets', score: kit.length ? kit.filter((r) => (r.qty || 0) >= r.target).length / kit.length : 0, detail: `${kit.filter((r) => (r.qty || 0) >= r.target).length} of ${kit.length} items at target` },
    { name: 'Checklists', page: 'checklists', next: 'Work through the checklists', score: lists.length ? lists.reduce((a, l) => a + progress(l).frac, 0) / lists.length : 0, detail: `${lists.filter((l) => progress(l).frac === 1).length} of ${lists.length} complete` },
    { name: 'Offline library', page: 'library', next: 'Save guidance pages for offline use', score: lib.length ? lib.filter((i) => i.file && -daysUntil(i.lastCaptured.slice(0, 10)) <= 90).length / lib.length : 0, detail: `${lib.filter((i) => i.file).length} of ${lib.length} pages cached` },
    { name: 'Offline maps', page: 'maps', next: 'Download maps of your area', score: capped(tilesCount / 300), detail: `${tilesCount.toLocaleString()} tiles saved` },
    { name: 'Backed up to USB', page: 'usb', next: 'Back up to a USB drive', score: backupAge == null ? 0 : backupAge <= 30 ? 1 : backupAge <= 90 ? 0.5 : 0.2, detail: st.lastUsbBackup ? `Last ${fmtDate(st.lastUsbBackup)}` : 'Never' },
    { name: 'Plan reviewed', page: 'planner', params: { tab: 'review' }, next: 'Review the plan and log it', score: reviewAge == null ? 0 : reviewAge <= st.reviewIntervalMonths * 30 ? 1 : 0.3, detail: lastReview ? `Last ${fmtDate(lastReview)}` : 'Never recorded' },
  ];
}

export async function render(root) {
  const tiles = await window.api.tiles.stats().catch(() => ({ files: 0 }));
  // Unfinished areas first, in the order they matter; finished ones drop to the bottom.
  const items = readiness(tiles.files).map((r, i) => ({ ...r, i })).sort((a, b) => (a.score >= 0.99) - (b.score >= 0.99) || a.i - b.i);
  const done = items.filter((i) => i.score >= 0.99).length;
  const hh = store.get('household');
  const st = store.settings();
  const exp = expiringItems(60);
  const meds = store.get('medications').filter((m) => (m.daysStock != null && m.daysStock < st.targetDays) || (daysUntil(m.repeatDue) != null && daysUntil(m.repeatDue) <= 7));
  const wc = store.get('weatherCache');
  const warn = store.get('warningsCache');
  const warnItems = warn ? warn.items : [];
  const link = (label, page, params) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); window.go(page, params); } }, label);

  const readinessTable = table([
    { label: 'Area', key: 'name' },
    { label: 'Status', get: (r) => h('div', { style: 'width:100px', title: Math.round(r.score * 100) + '%' }, bar(r.score, r.score > 0 && r.score < 0.99 ? 'warn' : '')) },
    { label: 'Detail', get: (r) => h('span', { class: 'muted' }, r.detail) },
    { label: 'Next step', get: (r) => (r.score >= 0.99 ? h('span', { class: 'muted' }, 'Done') : link(r.next, r.page, r.params)) },
  ], items);

  // Things to act on now: weather warnings, medicines, then expired and expiring items.
  const row = (main, sub, page, label, params) => h('div', { class: 'li' }, main, sub ? h('span', { class: 'sub' }, sub) : null, h('span', { class: 'spacer' }), link(label, page, params));
  const attention = [
    ...warnItems.map((w) => row(h('b', { style: /red/i.test(w.title) ? 'color:var(--red)' : 'color:var(--amber)' }, w.title), null, 'weather', 'Weather')),
    ...meds.map((m) => {
      const due = daysUntil(m.repeatDue);
      const why = [m.daysStock != null && m.daysStock < st.targetDays ? `${m.daysStock} days left` : null, due != null && due <= 7 ? `repeat due ${fmtDate(m.repeatDue)}` : null].filter(Boolean).join(', ');
      return row(h('span', null, (m.name || 'Medication') + (m.person ? ` (${m.person})` : '')), why, 'planner', 'Medications', { tab: 'medications' });
    }),
    ...exp.map((e) => row(h('span', { style: e.days < 0 ? 'color:var(--red)' : '' }, e.item), `${e.source}, ${e.days < 0 ? 'expired' : 'expires'} ${fmtDate(e.expiry)}`,
      e.source === 'First aid kit' ? 'firstaid' : 'supplies', e.source, e.source === 'First aid kit' ? { tab: 'kit' } : undefined)),
  ];

  let wxBody;
  if (wc) {
    const d = wc.data.daily;
    wxBody = table([
      { label: 'Day', get: (i) => new Date(d.time[i]).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }) },
      { label: 'Conditions', get: (i) => WMO[d.weather_code[i]] || '' },
      { label: '°C', get: (i) => `${Math.round(d.temperature_2m_max[i])} / ${Math.round(d.temperature_2m_min[i])}` },
      { label: 'Rain mm', num: true, get: (i) => d.precipitation_sum[i] },
      { label: 'Gust mph', num: true, get: (i) => h('span', { style: d.wind_gusts_10m_max[i] > 50 ? 'color:var(--red);font-weight:600' : '' }, Math.round(d.wind_gusts_10m_max[i])) },
    ], d.time.slice(0, 4).map((_, i) => i));
  } else wxBody = h('div', { class: 'muted' }, 'No forecast saved. Open Weather while online.');

  root.append(h('div', { class: 'stack' },
    hh.people.length ? null : h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => window.go('planner', { tab: 'household' }) }, 'Set up your household'),
      h('span', { class: 'muted' }, 'Start with your address and who lives here. The rest of the plan builds on it.')),
    h('div', { class: 'grid g21' },
      h('div', { class: 'stack' },
        panel('Needs attention', attention.length ? h('div', { class: 'list', style: 'max-height:240px' }, attention) : h('div', { class: 'muted' }, 'Nothing needs attention.'),
          warn ? null : summary(['Weather warnings not checked yet', 'warn'])),
        panel('Readiness', readinessTable, summary(`${done} of ${items.length} done`))),
      h('div', { class: 'stack' },
        panel('Forecast', wxBody, wc ? summary(fmtDate(wc.at, true)) : null),
        panel('Scenario plans', h('div', { class: 'row' }, store.get('scenarios').map((s) => h('button', { onclick: () => window.go('planner', { tab: 'scenarios', scenario: s.id }) }, s.name))))))));
}
