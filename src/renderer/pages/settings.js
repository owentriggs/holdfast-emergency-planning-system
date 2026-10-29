import * as store from '../lib/store.js';
import { h, panel, status, fmtBytes, confirmBox, icon } from '../lib/ui.js';

export async function render(root) {
  const s = store.settings();
  const set = (k, v) => { s[k] = v; store.save('settings'); };
  // A blank or too-small value is not saved (a target of 0 days breaks the readiness sums); leaving the box puts the saved value back.
  const num = (k, label, help, min = 1) => [h('label', null, label), h('div', { class: 'row' }, h('input', { type: 'number', min, step: 'any', value: s[k], style: 'width:90px',
    oninput: (e) => { const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v) && v >= min) set(k, v); },
    onchange: (e) => { e.target.value = s[k]; } }), help ? h('span', { class: 'muted' }, help) : null)];
  const info = await window.api.app.info();
  const wc = await window.api.webcache.stats();
  const tiles = await window.api.tiles.stats();

  root.append(h('div', { class: 'grid g2' },
    h('div', { class: 'stack' },
      panel('Planning targets', h('div', { class: 'form' },
        ...num('targetDays', 'Target days of supplies', 'GOV.UK recommends at least 3'),
        ...num('waterPerPersonDay', 'Drinking water L / person / day', 'GOV.UK: 3', 0.5),
        ...num('reviewIntervalMonths', 'Plan review interval (months)'))),
      panel('Connectivity', h('div', { class: 'form' },
        h('label', null, 'Offline mode'), h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: s.offlineMode, onchange: (e) => { set('offlineMode', e.target.checked); window.refreshNetState(); } }), 'Never go online (use saved data only)'),
        h('label', null, 'Weather'), h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: s.autoCheckWeather, onchange: (e) => set('autoCheckWeather', e.target.checked) }), 'Refresh forecast automatically when older than 3 hours'),
        ...num('keepVersions', 'Saved versions per web page'))),
      panel('Maps', h('div', { class: 'form' },
        h('label', null, 'Custom tile URL'), h('input', { value: s.customTileUrl, placeholder: 'https://provider/{z}/{x}/{y}.png?key=...', oninput: (e) => set('customTileUrl', e.target.value) }),
        h('label', null, 'Attribution'), h('input', { value: s.customTileAttribution, oninput: (e) => set('customTileAttribution', e.target.value) }),
        h('label', null, ''), h('span', { class: 'muted small' }, 'Use a provider whose terms allow offline caching. Reopen the Maps page after changing.'))),
      panel('Appearance', h('div', { class: 'form' },
        h('label', null, 'Theme'), h('select', { onchange: (e) => { set('theme', e.target.value); window.applyTheme(); } }, [['system', 'Follow Windows'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('option', { value: v, selected: s.theme === v }, l)))))),
    h('div', { class: 'stack' },
      panel('Data', h('div', { class: 'stack' },
        h('div', { class: 'kv' },
          h('span', null, 'Data folder'), h('span', { class: 'mono small' }, info.dataRoot),
          h('span', null, 'Web library'), h('span', null, `${wc.pages} pages, ${fmtBytes(wc.bytes)}`),
          h('span', null, 'Map tiles'), h('span', null, `${tiles.files.toLocaleString()} tiles, ${fmtBytes(tiles.bytes)}`),
          h('span', null, 'Version'), h('span', null, info.version)),
        h('div', { class: 'row' },
          h('button', { class: 'primary', onclick: async () => { store.flush(); const r = await window.api.backup.export(); if (r.ok) status('Backup saved to ' + r.path, 8000); } }, icon('export'), 'Export backup...'),
          h('button', { onclick: async () => {
            if (!(await confirmBox('Importing replaces your current plan data with the backup. Continue?', 'Import'))) return;
            try { const r = await window.api.backup.import(); if (r.ok) { status('Backup imported'); store.reloadFromDisk(); } } catch (e) { status('Import failed: ' + e.message, 8000); }
          } }, icon('import'), 'Import backup...'),
          h('button', { onclick: () => window.api.app.openDataFolder() }, icon('folder-open-outline'), 'Open data folder')),
        h('div', { class: 'note' }, 'The backup file contains your plan, contacts, supplies, checklists and settings (not cached web pages, map tiles or the document vault). It is not encrypted. To copy everything to a USB stick, with optional password protection, use the USB Backup page.'))),
      panel('About', h('div', { class: 'small' },
        h('p', null, 'Holdfast Emergency Planning System is a personal household planning tool. Guidance is summarised from GOV.UK Be Ready, Welsh Government, NHS, St John Ambulance, British Red Cross and Resuscitation Council UK.'),
        h('p', null, 'It does not replace official warnings or professional advice. In an emergency call 999.'))))));
}
