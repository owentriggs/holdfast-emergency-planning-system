import * as store from '../lib/store.js';
import { h, panel, editTable, uid, status, icon } from '../lib/ui.js';
import { RADIO_PRESETS } from '../data/radio.js';

let bandFilter = '';

export function render(root) {
  const mine = store.get('radio');
  const mineBox = h('div');
  const drawMine = () => mineBox.replaceChildren(editTable([
    { key: 'service', label: 'Service / station', width: '170px' },
    { key: 'band', label: 'Band', width: '130px' },
    { key: 'freq', label: 'Frequency', width: '100px' },
    { key: 'unit', label: 'Unit', type: 'select', options: ['MHz', 'kHz', ''], width: '60px' },
    { key: 'mode', label: 'Mode', width: '80px' },
    { key: 'use', label: 'Use / notes', type: 'textarea' },
  ], mine, () => store.save('radio'), { addLabel: 'Add frequency', newRow: () => ({ unit: 'MHz' }) }));
  drawMine();

  const presetBox = h('div');
  const bands = [...new Set(RADIO_PRESETS.map((p) => p.band))];
  const drawPresets = () => {
    const rows = RADIO_PRESETS.filter((p) => !bandFilter || p.band === bandFilter);
    presetBox.replaceChildren(
      h('div', { class: 'tbltools' },
        h('select', { onchange: (e) => { bandFilter = e.target.value; drawPresets(); } }, h('option', { value: '' }, 'All bands'), bands.map((b) => h('option', { selected: b === bandFilter }, b))),
        h('button', { onclick: () => {
          let n = 0;
          for (const p of rows) if (!mine.some((m) => m.service === p.service && m.freq === p.freq)) { mine.push({ id: uid(), ...p }); n++; }
          store.save('radio');
          drawMine();
          status(`Added ${n} frequencies`);
        } }, icon('playlist-plus'), 'Add all shown to my list'),
        h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, rows.length + ' presets')),
      h('div', { class: 'tblwrap', style: 'max-height:calc(100vh - 260px)' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['', 'Service', 'Band', 'Frequency', 'Mode', 'Licence', 'Notes'].map((t) => h('th', null, t)))),
        h('tbody', null, rows.map((p) => h('tr', null,
          h('td', { class: 'act' }, h('button', { title: 'Add to my list', onclick: () => {
            if (mine.some((m) => m.service === p.service && m.freq === p.freq)) return status('Already in your list');
            mine.push({ id: uid(), ...p });
            store.save('radio');
            drawMine();
          } }, icon('plus'))),
          h('td', null, p.service), h('td', { class: 'muted' }, p.band), h('td', { class: 'mono nowrap' }, `${p.freq} ${p.unit}`),
          h('td', null, p.mode), h('td', { class: 'small' }, p.licence), h('td', { class: 'small' }, p.use)))))));
  };
  drawPresets();

  root.append(h('div', { class: 'grid g2' },
    h('div', { class: 'stack' },
      panel('My frequencies (printed with the plan)', mineBox),
      h('div', { class: 'note' }, 'GOV.UK advises writing down the frequencies of the national and local stations you use for news, and keeping a battery or wind-up FM radio. FM frequencies depend on your nearest transmitter: tune in at home and record the exact number here.'),
      panel('Notes', h('div', { class: 'small' },
        h('p', null, h('b', null, 'Listening: '), 'In an emergency, local BBC and commercial radio carry official advice. BBC Radio Wales and Radio Cymru cover Wales; BBC Radio 4 and 5 Live are national.'),
        h('p', null, h('b', null, 'Two-way radio: '), 'PMR446 and CB (27/81 and CEPT) are licence-free in the UK. PMR446 handsets are limited to 0.5 W and typically reach 1 to 3 km in built-up areas. Agree a channel and CTCSS code with your household in advance and record it here.'),
        h('p', null, h('b', null, 'Licensed services: '), 'Amateur bands need an Ofcom licence to transmit. Do not transmit on marine, airband or emergency service frequencies.')))),
    panel('Preset library', presetBox)));
}
