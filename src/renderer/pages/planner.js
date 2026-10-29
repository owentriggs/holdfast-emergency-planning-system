import * as store from '../lib/store.js';
import { h, panel, tabs, editTable, uid, ageFrom, daysUntil, status, fmtDate, confirmBox, icon } from '../lib/ui.js';
import { suggestionsFor } from '../data/defaults.js';

const ROLES = ['', 'Adult', 'Parent / carer', 'Child', 'Older person', 'Dependant adult', 'Lodger / guest'];

let activeTab = 'household';
let activeScenario = null;

// Shown above a tab only where it saves a mistake.
const HELP = {
  household: 'Give children a parent or carer and their details print on their emergency card.',
  medications: 'Rows turn amber when stock is below the target days or a repeat prescription is due within a week.',
  documents: 'Where the paper originals are. Keep scanned copies in the Document vault.',
};

const TABS = [
  { id: 'household', label: 'Household', key: 'household' },
  { id: 'locations', label: 'Key locations', key: 'locations' },
  { id: 'utilities', label: 'Utilities', key: 'utilities' },
  { id: 'meeting', label: 'Meeting points', key: 'meeting' },
  { id: 'medications', label: 'Medications', key: 'medications' },
  { id: 'documents', label: 'Documents', key: 'documents' },
  { id: 'scenarios', label: 'Scenarios', key: 'scenarios' },
  { id: 'review', label: 'Review log', key: 'reviewLog' },
];

export function render(root, params = {}) {
  // Opened from elsewhere at a given tab or scenario, e.g. a scenario button on the dashboard.
  if (params.tab && VIEWS[params.tab]) activeTab = params.tab;
  if (params.scenario) activeScenario = params.scenario;
  const body = h('div');
  const draw = () => {
    const counts = {
      household: store.get('household').people.length,
      locations: store.get('locations').length,
      utilities: store.get('utilities').length,
      meeting: store.get('meeting').length + store.get('routes').length,
      medications: store.get('medications').length,
      documents: store.get('documents').length,
      scenarios: store.get('scenarios').length,
      review: store.get('reviewLog').length,
    };
    root.replaceChildren(
      tabs(TABS.map((t) => ({ ...t, count: counts[t.id] })), activeTab, (id) => { activeTab = id; draw(); }),
      body);
    body.replaceChildren(HELP[activeTab] ? h('div', { class: 'intro' }, HELP[activeTab]) : null, VIEWS[activeTab]());
  };
  draw();
}

const save = (k) => () => store.save(k);

const VIEWS = {
  household() {
    const hh = store.get('household');
    const f = (key, label, type = 'text', opts) => {
      const onIn = (e) => { hh[key] = e.target.value; store.save('household'); if (key === 'name' || key === 'postcode') window.refreshFooter(); };
      const inp = type === 'textarea' ? h('textarea', { rows: 2, oninput: onIn }, hh[key] || '')
        : type === 'select' ? h('select', { onchange: onIn }, opts.map((o) => h('option', { selected: hh[key] === o }, o)))
        : h('input', { type, value: hh[key] ?? '', oninput: onIn });
      return [h('label', null, label), inp];
    };
    const latLon = h('span', { class: 'mono', title: 'Set by looking up the postcode. Used for the weather forecast and to centre the map.' }, hh.lat ? `${hh.lat.toFixed(5)}, ${hh.lon.toFixed(5)}` : 'Not set: look up the postcode');
    const lookup = h('button', { onclick: async () => {
      const pc = (hh.postcode || '').replace(/\s+/g, '');
      if (!pc) return status('Enter a postcode first');
      try {
        const r = await window.api.net.get('https://api.postcodes.io/postcodes/' + encodeURIComponent(pc));
        hh.lat = r.result.latitude;
        hh.lon = r.result.longitude;
        hh.district = r.result.admin_district;
        hh.ward = r.result.admin_ward;
        hh.country = r.result.country;
        store.save('household');
        latLon.textContent = `${hh.lat.toFixed(5)}, ${hh.lon.toFixed(5)}  (${hh.district}, ${hh.country})`;
        status('Location set from postcode');
      } catch (e) {
        status('Postcode lookup failed: ' + e.message, 8000);
      }
    } }, icon('map-search-outline'), 'Look up');

    // Parent / carer links point at another person in the household (p:<id>) or a contact (c:<id>).
    if (hh.people.some((p) => !p.id)) { hh.people.forEach((p) => (p.id = p.id || uid())); store.save('household'); }
    const carerOptions = (row) => ['', ...hh.people.filter((p) => p !== row && p.name).map((p) => ({ value: 'p:' + p.id, label: p.name })),
      ...store.get('contacts').filter((c) => c.name).map((c) => ({ value: 'c:' + c.id, label: c.name + (c.relation ? ` (${c.relation})` : ' (contact)') }))];
    const people = editTable([
      { key: 'name', label: 'Name', width: '140px' },
      { key: 'role', label: 'Role', type: 'select', options: ROLES, width: '135px', title: 'Children and dependants get their parent or carer details on their emergency card' },
      { key: 'carer1', label: 'Parent / carer', type: 'select', options: carerOptions, width: '130px', title: 'Shown on their emergency card. Pick someone in the household or a contact.' },
      { key: 'carer2', label: 'Second carer', type: 'select', options: carerOptions, width: '130px' },
      { key: 'dob', label: 'Date of birth', type: 'date', width: '120px' },
      { key: 'age', label: 'Age', type: 'ro', num: true, compute: (r) => ageFrom(r.dob), width: '40px' },
      { key: 'mobile', label: 'Mobile', width: '135px' },
      { key: 'conditions', label: 'Medical conditions', type: 'textarea' },
      { key: 'allergies', label: 'Allergies' },
      { key: 'blood', label: 'Blood', type: 'select', options: ['', 'O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'Unknown'], width: '70px' },
      { key: 'needs', label: 'Support needs', type: 'textarea', title: 'Mobility, hearing, sight, care, equipment needing power' },
      { key: 'nhs', label: 'NHS no.', width: '100px' },
      { key: 'psr', label: 'PSR', type: 'checkbox', width: '36px', title: 'Registered on Priority Services Register' },
    ], hh.people, () => { store.save('household'); }, { addLabel: 'Add person' });

    const pets = editTable([
      { key: 'name', label: 'Name', width: '120px' },
      { key: 'species', label: 'Species / breed', width: '140px' },
      { key: 'description', label: 'Description' },
      { key: 'microchip', label: 'Microchip no.', width: '140px' },
      { key: 'vet', label: 'Vet', width: '160px' },
      { key: 'needs', label: 'Food / meds / needs', type: 'textarea' },
    ], hh.pets, save('household'), { addLabel: 'Add pet' });

    const text = (key, placeholder) => h('input', { value: hh[key] ?? '', placeholder: placeholder || '', oninput: (e) => { hh[key] = e.target.value; store.save('household'); if (key === 'name' || key === 'postcode') window.refreshFooter(); } });
    const area = (key, placeholder) => h('textarea', { rows: 2, placeholder: placeholder || '', oninput: (e) => { hh[key] = e.target.value; store.save('household'); } }, hh[key] || '');

    return h('div', { class: 'stack' },
      h('div', { class: 'grid g2' },
        panel('Address', h('div', { class: 'form' },
          h('label', null, 'Household name'), text('name', 'e.g. The Smith family'),
          h('label', null, 'Address'), area('address'),
          h('label', null, 'Postcode'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('div', { style: 'flex:1' }, text('postcode')), lookup),
          h('label', null, 'Coordinates'), h('div', { class: 'row' }, latLon, h('span', { class: 'spacer' }), h('button', { class: 'small', onclick: () => window.go('maps') }, icon('map-outline'), 'Map')),
          h('label', null, 'what3words'), text('what3words', 'e.g. filled.count.soap'),
          h('label', null, 'OS grid ref'), text('gridRef'),
          h('label', null, 'Access notes'), area('accessNotes', 'Key safe, gate codes, parking, how to find the house'))),
        panel('Property', h('div', { class: 'form' },
          f('propertyType', 'Property type', 'select', ['', 'House', 'Bungalow', 'Flat (ground floor)', 'Flat (upper floor)', 'Maisonette', 'Mobile home', 'Other']),
          f('floors', 'Floors'),
          f('floodRisk', 'Flood risk', 'select', ['', 'Unknown', 'Very low', 'Low', 'Medium', 'High']),
          f('heating', 'Heating type', 'select', ['', 'Mains gas', 'Electric', 'Oil', 'LPG', 'Heat pump', 'Solid fuel', 'Other']),
          h('label', null, 'General notes'), h('textarea', { rows: 5, oninput: (e) => { hh.notes = e.target.value; store.save('household'); } }, hh.notes || '')))),
      panel('People in the household', people),
      panel('Pets and animals', pets));
  },

  locations() {
    return h('div', { class: 'stack' },
      panel('Key locations', editTable([
        { key: 'item', label: 'Item', width: '260px' },
        { key: 'location', label: 'Location', placeholder: 'e.g. under kitchen sink' },
        { key: 'howTo', label: 'How to use / notes', type: 'textarea' },
        { key: 'checked', label: 'Last checked', type: 'date', width: '130px' },
      ], store.get('locations'), save('locations'), { addLabel: 'Add location', suggestions: suggestionsFor('locations'), emptyText: 'No locations recorded yet.' })));
  },

  utilities() {
    return panel('Utilities and accounts', editTable([
      { key: 'service', label: 'Service', width: '200px' },
      { key: 'provider', label: 'Provider', width: '160px' },
      { key: 'account', label: 'Account / policy no.', width: '160px' },
      { key: 'phone', label: 'Phone', width: '135px' },
      { key: 'emergency', label: 'Emergency line', width: '120px' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ], store.get('utilities'), save('utilities'), { addLabel: 'Add service', suggestions: suggestionsFor('utilities'), emptyText: 'No services recorded yet.' }));
  },

  meeting() {
    return h('div', { class: 'stack' },
      panel('Meeting points', editTable([
        { key: 'type', label: 'Type', type: 'select', options: ['Near home', 'Outside the area', 'Evacuation destination', 'Rest centre', 'Other'], width: '170px' },
        { key: 'name', label: 'Name', width: '160px' },
        { key: 'address', label: 'Address / description', type: 'textarea' },
        { key: 'lat', label: 'Lat', type: 'number', width: '90px', title: 'Shown on the map. Maps shows the coordinates under the cursor.' },
        { key: 'lon', label: 'Lon', type: 'number', width: '90px', title: 'Shown on the map. Maps shows the coordinates under the cursor.' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ], store.get('meeting'), save('meeting'), { addLabel: 'Add meeting point', newRow: () => ({ type: 'Other' }), suggestions: suggestionsFor('meeting'), emptyText: 'No meeting points yet.' })),
      panel('Routes', editTable([
        { key: 'name', label: 'Route', width: '220px' },
        { key: 'from', label: 'From', width: '120px' },
        { key: 'route', label: 'Primary route', type: 'textarea' },
        { key: 'alternative', label: 'Alternative', type: 'textarea' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ], store.get('routes'), save('routes'), { addLabel: 'Add route', suggestions: suggestionsFor('routes'), emptyText: 'No routes yet.' })));
  },

  medications() {
    const names = () => ['', ...store.get('household').people.map((p) => p.name).filter(Boolean)];
    const target = store.settings().targetDays;
    return h('div', { class: 'stack' },
      panel('Medications', editTable([
        { key: 'person', label: 'Person', type: 'select', options: names, width: '130px' },
        { key: 'name', label: 'Medication', width: '180px' },
        { key: 'dose', label: 'Dose', width: '100px' },
        { key: 'frequency', label: 'Frequency', width: '130px' },
        { key: 'purpose', label: 'For', width: '130px' },
        { key: 'daysStock', label: 'Days in stock', type: 'number', width: '90px' },
        { key: 'repeatDue', label: 'Repeat due', type: 'date', width: '125px' },
        { key: 'storage', label: 'Storage', type: 'select', options: ['', 'Room temp', 'Fridge', 'Keep cool'], width: '100px' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ], store.get('medications'), save('medications'), {
        addLabel: 'Add medication',
        rowClass: (r) => (r.daysStock != null && r.daysStock < target) || (daysUntil(r.repeatDue) != null && daysUntil(r.repeatDue) <= 7) ? 'warn' : '',
      })));
  },

  documents() {
    return panel('Documents', editTable([
      { key: 'document', label: 'Document', width: '230px' },
      { key: 'holder', label: 'Holder', width: '120px' },
      { key: 'ref', label: 'Reference no.', width: '140px' },
      { key: 'location', label: 'Original kept at', width: '150px' },
      { key: 'copy', label: 'Copy in grab bag', type: 'select', options: ['', 'Yes', 'No', 'Digital only'], width: '110px' },
      { key: 'expiry', label: 'Expiry', type: 'date', width: '125px' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ], store.get('documents'), save('documents'), {
      addLabel: 'Add document',
      suggestions: suggestionsFor('documents'),
      emptyText: 'No documents recorded yet.',
      rowClass: (r) => { const d = daysUntil(r.expiry); return d == null ? '' : d < 0 ? 'bad' : d < 90 ? 'warn' : ''; },
    }));
  },

  scenarios() {
    const list = store.get('scenarios');
    for (const s of list) s.steps = s.steps.map((t) => (typeof t === 'string' ? { id: uid(), text: t } : t));
    if (!list.find((s) => s.id === activeScenario)) activeScenario = list[0] && list[0].id;
    const wrap = h('div', { class: 'split', style: 'min-height:500px' });
    const draw = () => {
      const sc = list.find((s) => s.id === activeScenario);
      const side = h('div', { class: 'side' },
        h('div', { class: 'list' },
          list.map((s) => h('div', { class: 'li' + (s.id === activeScenario ? ' active' : ''), onclick: () => { activeScenario = s.id; draw(); } },
            h('span', null, s.name), h('span', { class: 'spacer' }), h('span', { class: 'sub' }, s.steps.length)))),
        h('div', { class: 'row', style: 'margin-top:6px' },
          h('button', { onclick: () => {
            const s = { id: uid(), name: 'New scenario', steps: [], notes: '' };
            list.push(s);
            activeScenario = s.id;
            store.save('scenarios');
            draw();
          } }, icon('plus'), 'Add scenario'),
          sc ? h('button', { class: 'danger', onclick: async () => {
            if (!(await confirmBox(`Delete scenario "${sc.name}"?`, 'Delete', true))) return;
            list.splice(list.indexOf(sc), 1);
            store.save('scenarios');
            activeScenario = null;
            draw();
          } }, icon('delete-outline'), 'Delete') : null));
      const bodyEl = h('div', { class: 'body' }, sc ? h('div', { class: 'stack' },
        panel('Scenario', h('div', { class: 'form' },
          h('label', null, 'Name'), h('input', { value: sc.name, oninput: (e) => { sc.name = e.target.value; store.save('scenarios'); side.querySelector('.li.active span').textContent = sc.name; } }),
          h('label', null, 'Trigger / when to use'), h('input', { value: sc.trigger || '', placeholder: 'e.g. Amber flood warning for our area', oninput: (e) => { sc.trigger = e.target.value; store.save('scenarios'); } }),
          h('label', null, 'Responsible'), h('input', { value: sc.owner || '', placeholder: 'Who leads / who does what', oninput: (e) => { sc.owner = e.target.value; store.save('scenarios'); } }))),
        panel('Actions', editTable([
          { key: 'text', label: 'Action', type: 'textarea' },
          { key: 'who', label: 'Who', width: '120px' },
        ], sc.steps, save('scenarios'), { addLabel: 'Add action', sortable: false, search: false })),
        panel('Notes', h('textarea', { rows: 4, oninput: (e) => { sc.notes = e.target.value; store.save('scenarios'); } }, sc.notes || ''))) : h('div', { class: 'note' }, 'No scenario selected'));
      wrap.replaceChildren(side, bodyEl);
    };
    draw();
    return wrap;
  },

  review() {
    const log = store.get('reviewLog');
    const months = store.settings().reviewIntervalMonths || 6;
    const last = log.filter((r) => r.type === 'Plan review' && r.date).map((r) => r.date).sort().pop();
    let due = null;
    if (last) { due = new Date(last); due.setMonth(due.getMonth() + months); }
    const d = due ? daysUntil(due.toISOString().slice(0, 10)) : null;
    return h('div', { class: 'stack' },
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'v' }, last ? fmtDate(last) : 'Never'), h('div', { class: 'l' }, 'Last plan review')),
        h('div', { class: 'stat ' + (d == null || d < 30 ? 'warn' : '') }, h('div', { class: 'v' }, due ? fmtDate(due) : 'Now'), h('div', { class: 'l' }, `Next review due (every ${months} months)`)),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, log.filter((r) => r.type === 'Drill').length), h('div', { class: 'l' }, 'Drills recorded'))),
      panel('Log', editTable([
        { key: 'date', label: 'Date', type: 'date', width: '130px' },
        { key: 'type', label: 'Type', type: 'select', options: ['Plan review', 'Drill', 'Kit check', 'Real incident', 'Other'], width: '130px' },
        { key: 'by', label: 'By', width: '130px' },
        { key: 'notes', label: 'Notes / lessons learned', type: 'textarea' },
      ], log, () => { store.save('reviewLog'); }, { addLabel: 'Add entry', newRow: () => ({ date: new Date().toISOString().slice(0, 10), type: 'Plan review' }) })));
  },
};
