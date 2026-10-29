import * as store from '../lib/store.js';
import { h, panel, editTable, chart, chartColors } from '../lib/ui.js';

const DEFAULT_TOOLS = {
  battery: { wh: 500, efficiency: 85 },
  loads: [
    { id: 'a', name: 'Router / broadband', watts: 10, hours: 24, on: true },
    { id: 'b', name: 'LED lamp', watts: 6, hours: 6, on: true },
    { id: 'c', name: 'Phone charging', watts: 10, hours: 2, on: true },
    { id: 'd', name: 'Fridge (average draw)', watts: 50, hours: 24, on: false },
    { id: 'e', name: 'CPAP / medical device', watts: 40, hours: 8, on: false },
  ],
  water: { pets: 0, petLitres: 1, days: 3, drink: 3, wash: 2 },
  bank: { bankMah: 20000, phoneMah: 4500, efficiency: 65 },
  powerOff: '',
};

export function render(root) {
  let t = store.get('tools');
  if (!t) { t = structuredClone(DEFAULT_TOOLS); store.set('tools', t); }
  const save = () => store.save('tools');
  let ch;

  // Power runtime
  const pwOut = h('div', { class: 'stats' });
  const pwChart = h('div', { class: 'chartbox', style: 'height:180px' });
  const calcPower = () => {
    const daily = t.loads.filter((l) => l.on).reduce((a, l) => a + (l.watts || 0) * (l.hours || 0), 0);
    const usable = (t.battery.wh || 0) * (t.battery.efficiency || 100) / 100;
    const peak = t.loads.filter((l) => l.on).reduce((a, l) => a + (l.watts || 0), 0);
    const days = daily ? usable / daily : 0;
    pwOut.replaceChildren(
      h('div', { class: 'stat' }, h('div', { class: 'v' }, Math.round(daily) + ' Wh'), h('div', { class: 'l' }, 'Daily use (ticked loads)')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, peak + ' W'), h('div', { class: 'l' }, 'Peak if all on at once')),
      h('div', { class: 'stat ' + (days >= store.settings().targetDays ? 'ok' : days >= 1 ? 'warn' : 'bad') }, h('div', { class: 'v' }, days.toFixed(1) + ' days'), h('div', { class: 'l' }, `Runtime (${Math.round(days * 24)} h)`)));
    if (ch) ch.destroy();
    const on = t.loads.filter((l) => l.on && l.watts && l.hours);
    ch = chart(pwChart, {
      type: 'doughnut',
      data: { labels: on.map((l) => l.name), datasets: [{ data: on.map((l) => l.watts * l.hours), backgroundColor: chartColors().series }] },
      options: { plugins: { legend: { position: 'right' }, title: { display: true, text: 'Share of daily Wh' } } },
    });
  };
  const num = (obj, key, label, step = 1) => [h('label', null, label), h('input', { type: 'number', step, value: obj[key], oninput: (e) => { obj[key] = Number(e.target.value); save(); recalc(); } })];

  // Water
  const waterOut = h('div', { class: 'stats' });
  const calcWater = () => {
    const p = store.householdSize();
    const w = t.water;
    const drink = p * w.drink * w.days;
    const wash = p * w.wash * w.days;
    const pets = w.pets * w.petLitres * w.days;
    waterOut.replaceChildren(
      h('div', { class: 'stat' }, h('div', { class: 'v' }, drink + ' L'), h('div', { class: 'l' }, `Drinking (${p} people)`)),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, wash + ' L'), h('div', { class: 'l' }, 'Cooking and washing')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, pets + ' L'), h('div', { class: 'l' }, 'Pets')),
      h('div', { class: 'stat ok' }, h('div', { class: 'v' }, drink + wash + pets + ' L'), h('div', { class: 'l' }, `Total for ${w.days} days (${Math.ceil((drink + wash + pets) / 2)} x 2 L bottles)`)));
  };

  // Power bank
  const bankOut = h('div', { class: 'stats' });
  const calcBank = () => {
    const b = t.bank;
    const charges = b.phoneMah ? (b.bankMah * (b.efficiency / 100)) / b.phoneMah : 0;
    bankOut.replaceChildren(h('div', { class: 'stat' }, h('div', { class: 'v' }, charges.toFixed(1)), h('div', { class: 'l' }, 'Full phone charges')));
  };

  // Fridge / freezer
  const foodOut = h('div');
  const calcFood = () => {
    if (!t.powerOff) return foodOut.replaceChildren(h('div', { class: 'muted' }, 'Enter the time the power went off.'));
    const off = new Date(t.powerOff);
    const add = (hrs) => new Date(off.getTime() + hrs * 3600000);
    const fmt = (d) => d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
    const now = new Date();
    const rows = [['Fridge (door kept shut)', 4], ['Half-full freezer', 24], ['Full freezer', 48]];
    foodOut.replaceChildren(h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Appliance'), h('th', null, 'Safe until about'), h('th', null, 'Status'))),
      h('tbody', null, rows.map(([n, hr]) => { const until = add(hr); const ok = now < until; return h('tr', { class: ok ? '' : 'bad' }, h('td', null, n), h('td', null, fmt(until)), h('td', null, ok ? `${Math.round((until - now) / 3600000)} h left` : 'Check food: discard if above 8°C for more than 4 h')); }))));
  };

  const recalc = () => { calcPower(); calcWater(); calcBank(); calcFood(); };

  root.append(
    h('div', { class: 'grid g2' },
      panel('Battery / power station runtime', h('div', { class: 'stack' },
        h('div', { class: 'form' }, ...num(t.battery, 'wh', 'Capacity (Wh)'), ...num(t.battery, 'efficiency', 'Inverter efficiency %')),
        editTable([
          { key: 'on', label: 'On', type: 'checkbox', width: '36px' },
          { key: 'name', label: 'Device' },
          { key: 'watts', label: 'Watts', type: 'number', width: '70px' },
          { key: 'hours', label: 'Hours / day', type: 'number', width: '80px' },
          { key: 'wh', label: 'Wh / day', type: 'ro', num: true, width: '70px', compute: (r) => Math.round((r.watts || 0) * (r.hours || 0)) },
        ], t.loads, () => { save(); calcPower(); }, { addLabel: 'Add device', newRow: () => ({ on: true, watts: 0, hours: 1 }), search: false }),
        pwOut, pwChart,
        h('div', { class: 'note' }, 'Wh = mAh x V / 1000. A 20,000 mAh power bank at 3.7 V is about 74 Wh. Never run generators indoors.'))),
      h('div', { class: 'stack' },
        panel('Water needed', h('div', { class: 'stack' },
          h('div', { class: 'form' }, ...num(t.water, 'days', 'Days'), ...num(t.water, 'drink', 'Drinking L / person / day', 0.5), ...num(t.water, 'wash', 'Washing L / person / day', 0.5), ...num(t.water, 'pets', 'Pets'), ...num(t.water, 'petLitres', 'L / pet / day', 0.1)),
          waterOut, h('div', { class: 'note' }, 'Household size comes from the Plan page.'))),
        panel('Power bank charges', h('div', { class: 'stack' },
          h('div', { class: 'form' }, ...num(t.bank, 'bankMah', 'Power bank mAh'), ...num(t.bank, 'phoneMah', 'Phone battery mAh'), ...num(t.bank, 'efficiency', 'Real-world efficiency %')),
          bankOut)),
        panel('Fridge and freezer during a power cut', h('div', { class: 'stack' },
          h('div', { class: 'form' }, h('label', null, 'Power went off at'), h('input', { type: 'datetime-local', value: t.powerOff, oninput: (e) => { t.powerOff = e.target.value; save(); calcFood(); } })),
          foodOut,
          h('div', { class: 'note' }, 'Keep doors closed. Typical figures; check with a fridge thermometer.'))))));
  recalc();
  return () => ch && ch.destroy();
}
