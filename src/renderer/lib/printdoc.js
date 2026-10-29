// Builds printable HTML documents from the stored data.
import * as store from './store.js';
import { esc, ageFrom, fmtDate } from './ui.js';
import { NATIONAL_NUMBERS } from '../data/defaults.js';
import { GUIDES, SOURCES, SEVERITY } from '../data/firstaid.js';

const CSS = `
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10pt; color: #000; margin: 0; }
h1 { font-size: 18pt; margin: 0 0 2mm; }
h2 { font-size: 13pt; margin: 6mm 0 2mm; padding-bottom: 1mm; border-bottom: 2px solid #000; break-after: avoid; }
h3 { font-size: 11pt; margin: 4mm 0 1.5mm; break-after: avoid; }
p { margin: 1mm 0; }
table { border-collapse: collapse; width: 100%; margin: 1mm 0 3mm; }
th, td { border: 1px solid #777; padding: 1mm 1.5mm; text-align: left; vertical-align: top; font-size: 9pt; }
th { background: #e6e6e6; }
tr { break-inside: avoid; }
.meta { color: #444; font-size: 9pt; }
.box { border: 2px solid #000; padding: 2mm 3mm; margin: 2mm 0; }
.red { border-color: #b00; }
.big { font-size: 16pt; font-weight: 700; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
ol, ul { margin: 1mm 0; padding-left: 6mm; }
li { margin: 0.6mm 0; }
.guide { break-inside: avoid-page; border-top: 1px solid #999; padding-top: 2mm; margin-top: 3mm; }
.tick { width: 6mm; text-align: center; font-size: 12pt; }
.sev { display: inline-block; border: 1px solid #000; padding: 0 2mm; font-size: 8pt; font-weight: 700; margin-left: 2mm; }
.pb { break-before: page; }
.card { width: 85mm; border: 1px dashed #000; padding: 2mm; font-size: 8pt; display: inline-block; vertical-align: top; margin: 0 3mm 3mm 0; }
.card table td, .card table th { font-size: 7.5pt; padding: 0.4mm 1mm; }
.card .carer { border: 1.5px solid #000; padding: 1mm; margin: 1mm 0; }
.card .carer table { margin: 0.5mm 0 0; }
.card { break-inside: avoid; }
.footer { margin-top: 6mm; font-size: 8pt; color: #555; border-top: 1px solid #999; padding-top: 1mm; }
.empty { color: #777; font-style: italic; }
@media screen { body { padding: 10mm; } }
`;

function tbl(cols, rows, empty = 'None recorded') {
  if (!rows.length) return `<p class="empty">${empty}</p>`;
  return `<table><thead><tr>${cols.map((c) => `<th${c.w ? ` style="width:${c.w}"` : ''}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${cols.map((c) => `<td>${c.raw ? (c.get ? c.get(r) : r[c.key]) ?? '' : esc(c.get ? c.get(r) : r[c.key])}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

const nonEmpty = (rows, keys) => rows.filter((r) => keys.some((k) => r[k] != null && String(r[k]).trim() !== ''));

export const SECTIONS = [
  { id: 'summary', label: 'Summary page (address, people, key numbers)', build: summary },
  { id: 'contacts', label: 'Contacts and national numbers', build: contacts },
  { id: 'people', label: 'People, medical details and pets', build: people },
  { id: 'medications', label: 'Medications', build: medications },
  { id: 'locations', label: 'Key locations (stopcock, meters, kit)', build: locations },
  { id: 'utilities', label: 'Utilities and accounts', build: utilities },
  { id: 'meeting', label: 'Meeting points and routes', build: meeting },
  { id: 'scenarios', label: 'Scenario plans', build: scenarios },
  { id: 'documents', label: 'Documents register', build: documents },
  { id: 'radio', label: 'Radio frequencies', build: radio },
  { id: 'supplies', label: 'Supplies and stock', build: supplies },
  { id: 'checklists', label: 'Checklists', build: checklists },
  { id: 'kit', label: 'First aid kit inventory', build: kit },
  { id: 'firstaid', label: 'First aid guides', build: firstaid },
  { id: 'cards', label: 'Wallet cards (cut out)', build: cards },
];

function summary() {
  const hh = store.get('household');
  const ice = store.get('contacts').filter((c) => c.ice || c.category === 'Out-of-area contact').filter((c) => c.name || c.phone);
  const mp = nonEmpty(store.get('meeting'), ['name', 'address']);
  return `
  <h1>Household Emergency Plan</h1>
  <p class="meta">${esc(hh.name || '')} &middot; Printed ${fmtDate(new Date().toISOString(), true)}</p>
  <div class="box red"><span class="big">Emergency: 999 or 112</span> &nbsp; NHS non-emergency: <b>111</b> &nbsp; Power cut: <b>105</b> &nbsp; Gas: <b>0800 111 999</b> &nbsp; Floodline: <b>0345 988 1188</b></div>
  <div class="cols">
    <div>
      <h3>Address</h3>
      <p>${esc(hh.address || '').replace(/\n/g, '<br>')}<br><b>${esc(hh.postcode || '')}</b></p>
      ${hh.what3words ? `<p>what3words: <b>///${esc(hh.what3words.replace(/^\/+/, ''))}</b></p>` : ''}
      ${hh.lat ? `<p>Lat/Lon: ${hh.lat.toFixed(5)}, ${hh.lon.toFixed(5)}</p>` : ''}
      ${hh.gridRef ? `<p>OS grid ref: ${esc(hh.gridRef)}</p>` : ''}
      ${hh.accessNotes ? `<p>Access: ${esc(hh.accessNotes)}</p>` : ''}
    </div>
    <div>
      <h3>Meeting points</h3>
      ${tbl([{ label: 'Type', key: 'type' }, { label: 'Place', get: (r) => [r.name, r.address].filter(Boolean).join(', ') }], mp)}
    </div>
  </div>
  <h3>People</h3>
  ${tbl([{ label: 'Name', key: 'name' }, { label: 'Age', get: (r) => ageFrom(r.dob) }, { label: 'Mobile', key: 'mobile' }, { label: 'Medical / allergies', get: (r) => [r.conditions, r.allergies && 'Allergies: ' + r.allergies].filter(Boolean).join('. ') }, { label: 'Support needs', key: 'needs' }], hh.people)}
  <h3>Emergency contacts</h3>
  ${tbl([{ label: 'Name', key: 'name' }, { label: 'Role', get: (r) => r.relation || r.category }, { label: 'Phone', key: 'phone' }, { label: 'Alt', key: 'alt' }], ice)}
  <h3>Key controls</h3>
  ${tbl([{ label: 'Item', key: 'item', w: '35%' }, { label: 'Location', key: 'location' }], nonEmpty(store.get('locations'), ['location']).slice(0, 8))}`;
}

function contacts() {
  return `<h2>Contacts</h2>
  ${tbl([{ label: 'Category', key: 'category' }, { label: 'Name', key: 'name' }, { label: 'Relation', key: 'relation' }, { label: 'Phone', key: 'phone' }, { label: 'Alt', key: 'alt' }, { label: 'Email', key: 'email' }, { label: 'Notes', key: 'notes' }], nonEmpty(store.get('contacts'), ['name', 'phone']))}
  <h3>National numbers</h3>
  ${tbl([{ label: 'Service', key: 'name', w: '30%' }, { label: 'Number', key: 'number', w: '18%' }, { label: 'Notes', key: 'notes' }], NATIONAL_NUMBERS)}`;
}

function people() {
  const hh = store.get('household');
  return `<h2>People and pets</h2>
  ${tbl([{ label: 'Name', key: 'name' }, { label: 'DOB', get: (r) => fmtDate(r.dob) }, { label: 'Mobile', key: 'mobile' }, { label: 'Conditions', key: 'conditions' }, { label: 'Allergies', key: 'allergies' }, { label: 'Blood', key: 'blood' }, { label: 'Support needs', key: 'needs' }, { label: 'NHS no.', key: 'nhs' }, { label: 'PSR', get: (r) => (r.psr ? 'Yes' : '') }], hh.people)}
  <h3>Pets</h3>
  ${tbl([{ label: 'Name', key: 'name' }, { label: 'Species', key: 'species' }, { label: 'Description', key: 'description' }, { label: 'Microchip', key: 'microchip' }, { label: 'Vet', key: 'vet' }, { label: 'Needs', key: 'needs' }], hh.pets)}`;
}

function medications() {
  return `<h2>Medications</h2>
  ${tbl([{ label: 'Person', key: 'person' }, { label: 'Medication', key: 'name' }, { label: 'Dose', key: 'dose' }, { label: 'Frequency', key: 'frequency' }, { label: 'For', key: 'purpose' }, { label: 'Storage', key: 'storage' }, { label: 'Notes', key: 'notes' }], store.get('medications'))}`;
}

function locations() {
  return `<h2>Key locations</h2>
  ${tbl([{ label: 'Item', key: 'item', w: '28%' }, { label: 'Location', key: 'location', w: '25%' }, { label: 'How to use', key: 'howTo' }], store.get('locations'))}`;
}

function utilities() {
  return `<h2>Utilities and accounts</h2>
  ${tbl([{ label: 'Service', key: 'service' }, { label: 'Provider', key: 'provider' }, { label: 'Account', key: 'account' }, { label: 'Phone', key: 'phone' }, { label: 'Emergency', key: 'emergency' }, { label: 'Notes', key: 'notes' }], store.get('utilities'))}`;
}

function meeting() {
  return `<h2>Meeting points</h2>
  ${tbl([{ label: 'Type', key: 'type' }, { label: 'Name', key: 'name' }, { label: 'Address', key: 'address' }, { label: 'Lat/Lon', get: (r) => (r.lat ? `${r.lat}, ${r.lon}` : '') }, { label: 'Notes', key: 'notes' }], store.get('meeting'))}
  <h3>Routes</h3>
  ${tbl([{ label: 'Route', key: 'name' }, { label: 'From', key: 'from' }, { label: 'Primary', key: 'route' }, { label: 'Alternative', key: 'alternative' }, { label: 'Notes', key: 'notes' }], store.get('routes'))}`;
}

function scenarios() {
  return `<h2>Scenario plans</h2>` + store.get('scenarios').map((s) => `
    <div class="guide"><h3>${esc(s.name)}</h3>
    ${s.trigger ? `<p><b>When:</b> ${esc(s.trigger)}</p>` : ''}${s.owner ? `<p><b>Who:</b> ${esc(s.owner)}</p>` : ''}
    <ol>${s.steps.map((t) => (typeof t === 'string' ? { text: t } : t)).map((t) => `<li>${esc(t.text)}${t.who ? ` <i>(${esc(t.who)})</i>` : ''}</li>`).join('')}</ol>
    ${s.notes ? `<p>${esc(s.notes)}</p>` : ''}</div>`).join('');
}

function documents() {
  return `<h2>Documents register</h2>
  ${tbl([{ label: 'Document', key: 'document' }, { label: 'Holder', key: 'holder' }, { label: 'Ref', key: 'ref' }, { label: 'Kept at', key: 'location' }, { label: 'Copy', key: 'copy' }, { label: 'Expiry', get: (r) => fmtDate(r.expiry) }, { label: 'Notes', key: 'notes' }], store.get('documents'))}`;
}

function radio() {
  return `<h2>Radio frequencies</h2>
  ${tbl([{ label: 'Service / station', key: 'service' }, { label: 'Band', key: 'band' }, { label: 'Frequency', get: (r) => `${r.freq} ${r.unit || ''}` }, { label: 'Mode', key: 'mode' }, { label: 'Use / notes', key: 'use' }], store.get('radio'), 'No frequencies saved. Add them on the Radio page.')}
  <p class="meta">Keep a battery or wind-up FM radio. Transmit only on licence-free bands (PMR446, CB) unless licensed.</p>`;
}

function supplies() {
  return `<h2>Supplies and stock</h2>
  ${tbl([{ label: 'Category', key: 'category' }, { label: 'Item', key: 'item' }, { label: 'Qty', get: (r) => `${r.qty ?? ''} ${r.unit || ''}` }, { label: 'Expiry', get: (r) => fmtDate(r.expiry) }, { label: 'Stored at', key: 'location' }, { label: 'Notes', key: 'notes' }], store.get('supplies'))}`;
}

function checklists(opts) {
  const ids = opts.checklistIds;
  return store.get('checklists').filter((c) => !ids || ids.includes(c.id)).map((c) => `
    <h2>${esc(c.name)}</h2>
    ${tbl([{ label: '✓', raw: true, get: (r) => (r.done ? '&#9745;' : '&#9744;'), w: '6mm' }, { label: 'Item', key: 'text' }, { label: 'Qty / detail', key: 'qty', w: '22%' }, { label: 'Notes', key: 'note', w: '25%' }], c.items)}`).join('');
}

function kit() {
  return `<h2>First aid kit inventory</h2>
  ${tbl([{ label: 'Item', key: 'item' }, { label: 'Have', key: 'qty' }, { label: 'Target', key: 'target' }, { label: 'Expiry', get: (r) => fmtDate(r.expiry) }, { label: 'Location', key: 'location' }, { label: 'Notes', key: 'notes' }], store.get('firstAidKit'))}`;
}

export function guideHtml(g) {
  return `<div class="guide">
    <h3>${esc(g.title)}<span class="sev">${esc(SEVERITY[g.sev].label.toUpperCase())}</span></h3>
    <p><i>${esc(g.summary)}</i></p>
    <ol>${g.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    ${g.call && g.call.length ? `<p><b>Get help:</b></p><ul>${g.call.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    ${g.dont && g.dont.length ? `<p><b>Do not:</b></p><ul>${g.dont.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    ${g.notes ? `<p>${esc(g.notes)}</p>` : ''}
    <p class="meta">Source: ${g.src.map((s) => SOURCES[s].name).join(', ')}</p></div>`;
}

function firstaid(opts) {
  const ids = opts.guideIds;
  const list = GUIDES.filter((g) => !ids || ids.includes(g.id));
  return `<h2>First aid</h2>
  <p class="meta">Summary guidance from NHS, St John Ambulance, British Red Cross and Resuscitation Council UK. Not a substitute for training. In an emergency call 999.</p>
  ${list.map(guideHtml).join('')}`;
}

// Resolves a parent / carer link: "p:<id>" is someone in the household, "c:<id>" a contact.
function carer(ref, hh, contacts) {
  if (!ref) return null;
  const [kind, id] = [ref.slice(0, 1), ref.slice(2)];
  if (kind === 'p') {
    const p = hh.people.find((x) => x.id === id);
    return p && { ref, name: p.name, relation: p.role || 'Household', phone: p.mobile, alt: '' };
  }
  const c = contacts.find((x) => x.id === id);
  return c && { ref, name: c.name, relation: c.relation || c.category, phone: c.phone, alt: c.alt };
}

function cards() {
  const hh = store.get('household');
  const contacts = store.get('contacts');
  const ice = contacts.filter((c) => (c.ice || c.category === 'Out-of-area contact') && (c.name || c.phone));
  const mp = nonEmpty(store.get('meeting'), ['name', 'address']).slice(0, 2);
  const card = (p) => {
    const carers = p ? [p.carer1, p.carer2].filter((r, i, a) => r && a.indexOf(r) === i).map((r) => carer(r, hh, contacts)).filter(Boolean) : [];
    const cares = p ? hh.people.filter((x) => x !== p && [x.carer1, x.carer2].includes('p:' + p.id)) : [];
    const idLine = p ? [p.dob && `Born ${fmtDate(p.dob)} (${ageFrom(p.dob)})`, p.blood && p.blood !== 'Unknown' && `Blood ${p.blood}`, p.nhs && `NHS ${p.nhs}`].filter(Boolean) : [];
    const shownIds = new Set(carers.map((c) => c.ref));
    const iceRows = ice.filter((c) => !shownIds.has('c:' + c.id)).slice(0, Math.max(1, 4 - carers.length));
    return `<div class="card">
    <b>EMERGENCY CARD${p ? ': ' + esc(p.name) : ''}</b>${p && p.role ? ` <span class="meta">(${esc(p.role)})</span>` : ''}<br>
    ${idLine.length ? esc(idLine.join(', ')) + '<br>' : ''}
    ${esc(hh.address || '').split('\n')[0] || ''} ${esc(hh.postcode || '')}<br>
    ${p && (p.conditions || p.allergies) ? `<b>Medical:</b> ${esc([p.conditions, p.allergies && 'Allergies: ' + p.allergies].filter(Boolean).join('. '))}<br>` : ''}
    ${p && p.needs ? `<b>Needs:</b> ${esc(p.needs)}<br>` : ''}
    ${carers.length ? `<div class="carer"><b>If I am found or need help, contact my parent / carer:</b>
      <table>${carers.map((c) => `<tr><td>${esc(c.name)}${c.relation ? ` <span class="meta">${esc(c.relation)}</span>` : ''}</td><td><b>${esc(c.phone || 'no number recorded')}</b>${c.alt ? '<br>' + esc(c.alt) : ''}</td></tr>`).join('')}</table></div>` : ''}
    ${cares.length ? `<b>I care for:</b> ${esc(cares.map((x) => x.name + (x.dob ? ` (${ageFrom(x.dob)})` : '')).join(', '))}. They may need checking on.<br>` : ''}
    <table>${iceRows.map((c) => `<tr><td>${esc(c.name || c.category)}</td><td><b>${esc(c.phone || '')}</b></td></tr>`).join('')}
    ${mp.map((m) => `<tr><td>${esc(m.type)}</td><td>${esc(m.name || m.address)}</td></tr>`).join('')}</table>
    999 / 112 &middot; NHS 111 &middot; Power 105 &middot; Gas 0800 111 999</div>`;
  };
  const ppl = hh.people.length ? hh.people : [null];
  return `<h2>Wallet cards</h2>${ppl.map(card).join('')}`;
}

export function buildDocument(sectionIds, opts = {}) {
  const parts = SECTIONS.filter((s) => sectionIds.includes(s.id)).map((s, i) => `<section${i && opts.pageBreaks ? ' class="pb"' : ''}>${s.build(opts)}</section>`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Emergency Plan</title><style>${CSS}</style></head><body>${parts.join('')}
  <div class="footer">Holdfast Emergency Planning System &middot; Printed ${fmtDate(new Date().toISOString(), true)} &middot; Review regularly and keep with your important documents.</div></body></html>`;
}
