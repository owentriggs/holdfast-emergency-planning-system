import * as store from '../lib/store.js';
import { h, panel, table, bar, stat, fmtDate, daysUntil } from '../lib/ui.js';
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
    { name: 'Household details', page: 'planner', score: (hh.postcode ? 0.3 : 0) + (hh.address ? 0.2 : 0) + (hh.people.length ? 0.5 : 0), detail: `${hh.people.length} people, ${hh.postcode || 'no postcode'}` },
    { name: 'Emergency contacts', page: 'contacts', score: capped(contacts.filter((c) => c.phone && (c.ice || c.category === 'Out-of-area contact')).length / 2), detail: `${contacts.filter((c) => c.phone).length} contacts with numbers, ${contacts.filter((c) => c.phone && (c.ice || c.category === 'Out-of-area contact')).length} ICE / out-of-area` },
    { name: 'Meeting points', page: 'planner', score: capped(store.get('meeting').filter((m) => m.name || m.address).length / 2), detail: `${store.get('meeting').filter((m) => m.name || m.address).length} set` },
    { name: 'Key locations recorded', page: 'planner', score: locs.length ? locs.filter((l) => l.location).length / locs.length : 0, detail: `${locs.filter((l) => l.location).length} of ${locs.length}` },
    { name: 'Drinking water', page: 'supplies', score: capped(water.days / st.targetDays), detail: `${water.litres} of ${water.need} litres (${water.days.toFixed(1)} of ${st.targetDays} days)` },
    { name: 'Food', page: 'supplies', score: capped((cov.Food || 0) / st.targetDays), detail: `${(cov.Food || 0).toFixed(1)} of ${st.targetDays} days` },
    { name: 'First aid kit', page: 'firstaid', score: kit.length ? kit.filter((r) => (r.qty || 0) >= r.target).length / kit.length : 0, detail: `${kit.filter((r) => (r.qty || 0) >= r.target).length} of ${kit.length} items at target` },
    { name: 'Checklists', page: 'checklists', score: lists.length ? lists.reduce((a, l) => a + progress(l).frac, 0) / lists.length : 0, detail: `${lists.filter((l) => progress(l).frac === 1).length} of ${lists.length} complete` },
    { name: 'Offline library', page: 'library', score: lib.length ? lib.filter((i) => i.file && -daysUntil(i.lastCaptured.slice(0, 10)) <= 90).length / lib.length : 0, detail: `${lib.filter((i) => i.file).length} of ${lib.length} pages cached` },
    { name: 'Offline maps', page: 'maps', score: capped(tilesCount / 300), detail: `${tilesCount.toLocaleString()} tiles saved` },
    { name: 'Backed up to USB', page: 'usb', score: backupAge == null ? 0 : backupAge <= 30 ? 1 : backupAge <= 90 ? 0.5 : 0.2, detail: st.lastUsbBackup ? `Last ${fmtDate(st.lastUsbBackup)}` : 'Never' },
    { name: 'Plan reviewed', page: 'planner', score: reviewAge == null ? 0 : reviewAge <= st.reviewIntervalMonths * 30 ? 1 : 0.3, detail: lastReview ? `Last ${fmtDate(lastReview)}` : 'Never recorded' },
  ];
}

export async function render(root) {
  const tiles = await window.api.tiles.stats().catch(() => ({ files: 0 }));
  const items = readiness(tiles.files);
  const overall = items.reduce((a, i) => a + i.score, 0) / items.length;
  const done = items.filter((i) => i.score >= 0.99).length;
  // Colour only what needs doing: partly done is amber, done and not started stay neutral.
  const cls = (v) => (v > 0 && v < 0.99 ? 'warn' : '');
  const st = store.settings();
  const exp = expiringItems(60);
  const meds = store.get('medications').filter((m) => (m.daysStock != null && m.daysStock < st.targetDays) || (daysUntil(m.repeatDue) != null && daysUntil(m.repeatDue) <= 7));
  const wc = store.get('weatherCache');
  const warn = store.get('warningsCache');
  const warnItems = warn ? warn.items : [];

  const readinessTable = table([
    { label: 'Area', get: (r) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); window.go(r.page); } }, r.name) },
    { label: 'Status', get: (r) => h('div', { style: 'width:120px', title: Math.round(r.score * 100) + '%' }, bar(r.score, cls(r.score))) },
    { label: 'Detail', get: (r) => h('span', { class: 'muted' }, r.detail) },
  ], items);

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
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'v' }, Math.round(overall * 100) + '%'), h('div', { class: 'l' }, `Ready, ${done} of ${items.length} areas`), bar(overall)),
      stat('Expired or expiring in 60 days', exp.length, exp.some((e) => e.days < 0) ? 'bad' : exp.length ? 'warn' : ''),
      stat('Medicines needing attention', meds.length, meds.length ? 'warn' : ''),
      stat('Met Office warnings', warn ? warnItems.length : '-', warnItems.length ? 'warn' : '')),
    h('div', { class: 'grid g21' },
      panel('Readiness', readinessTable),
      h('div', { class: 'stack' },
        panel('Forecast', wxBody, wc ? h('span', { class: 'muted small' }, fmtDate(wc.at, true)) : null),
        panel('Weather warnings', warnItems.length ? table([{ label: 'Warning', key: 'title' }, { label: 'Issued', get: (r) => fmtDate(r.date, true) }], warnItems) : h('div', { class: 'muted' }, warn ? 'None in force at last check (' + fmtDate(warn.at, true) + ')' : 'Not checked yet')))),
    h('div', { class: 'grid g21' },
      panel('Expired and expiring (60 days)', table([
        { label: 'Item', key: 'item' }, { label: 'Source', key: 'source' }, { label: 'Expiry', get: (r) => fmtDate(r.expiry) }, { label: 'Days', key: 'days', num: true },
      ], exp, { rowClass: (r) => (r.days < 0 ? 'bad' : 'warn'), emptyText: 'Nothing expiring soon', maxHeight: '220px' })),
      panel('Scenario plans', h('div', { class: 'row' }, store.get('scenarios').map((s) => h('button', { onclick: () => window.go('planner', { tab: 'scenarios', scenario: s.id }) }, s.name)))))));
}
