// Builds printable HTML documents from the stored data.
import * as store from './store.js';
import { esc, ageFrom, fmtDate } from './ui.js';
import { NATIONAL_NUMBERS } from '../data/defaults.js';
import { GUIDES, SOURCES, SEVERITY } from '../data/firstaid.js';
import { hexField } from './hexfield.js';

// Brand red from the logo; everything else is black ink and greys so it photocopies well.
const CSS = `
@page { size: A4; margin: 14mm 14mm 15mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Arial, sans-serif; font-size: 9.5pt; line-height: 1.35; color: #1b1b1b; margin: 0; counter-reset: sec; }
h2 { font-size: 14pt; font-weight: 600; margin: 7mm 0 2mm; padding-top: 1.5mm; border-top: 0.75pt solid #1b1b1b; break-after: avoid; }
section { counter-increment: sec; }
section > h2:first-child::before { content: counter(sec, decimal-leading-zero); color: #b3261e; font-size: 10pt; font-weight: 700; margin-right: 3mm; vertical-align: 1.5pt; }
h3 { font-size: 10.5pt; font-weight: 600; margin: 4mm 0 1mm; break-after: avoid; }
p { margin: 1mm 0; }
a { color: inherit; text-decoration: none; }
table { border-collapse: collapse; width: 100%; margin: 0.5mm 0 2mm; }
th { font-size: 6.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6pt; color: #5f6368; text-align: left; border-bottom: 0.75pt solid #1b1b1b; padding: 0.8mm 2mm 0.8mm 0; }
td { font-size: 9pt; vertical-align: top; border-bottom: 0.4pt solid #d4d4d4; padding: 1.1mm 2mm 1.1mm 0; }
tr { break-inside: avoid; }
.meta { color: #5f6368; font-size: 8pt; }
.empty { color: #8a8a8a; font-size: 8.5pt; font-style: italic; margin: 0.5mm 0 2mm; }
ol, ul { margin: 1mm 0; padding-left: 5mm; }
li { margin: 0.5mm 0; break-inside: avoid; }
li::marker { color: #5f6368; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
.twocol { column-count: 2; column-gap: 7mm; column-rule: 0.4pt solid #e2e2e2; orphans: 3; widows: 3; }
.guide { margin: 0 0 4mm; }
.guide h3 { margin: 0 0 0.8mm; }
.guide .lead { color: #444; font-style: italic; }
.guide .sub { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6pt; color: #5f6368; margin: 1.5mm 0 0; }
.sev { font-size: 6.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5pt; border: 0.6pt solid currentColor; border-radius: 0.6mm; padding: 0 1mm; margin-left: 2mm; vertical-align: 1.5pt; white-space: nowrap; }
.sev-call999 { color: #b3261e; }
.sev-urgent { color: #8a5a00; }
.sev-minor { color: #5f6368; }
.tick { width: 5mm; }
.tick i { display: inline-block; width: 3.2mm; height: 3.2mm; border: 0.75pt solid #1b1b1b; border-radius: 0.5mm; font-style: normal; font-size: 7pt; line-height: 3mm; text-align: center; }
.pb { break-before: page; }

/* Masthead, used when there is no cover */
.mast { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2pt solid #b3261e; padding-bottom: 2mm; margin-bottom: 3mm; }
.mast .k { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2pt; color: #b3261e; }
.mast .t { font-size: 16pt; font-weight: 600; }

/* Cover: fills the whole first sheet */
@page cover { margin: 0; }
.cover { page: cover; position: relative; width: 210mm; height: 296mm; overflow: hidden; break-after: page; }
.cover svg.hex { position: absolute; left: 0; top: 0; }
.cover .title { position: absolute; left: 22mm; right: 22mm; top: 168mm; }
@font-face { font-family: 'Tektur'; src: url('app://assets/fonts/tektur-600.woff2') format('woff2'); font-weight: 600; }
.cover .brand { display: flex; align-items: center; gap: 4mm; margin-bottom: 8mm; font-family: 'Tektur', 'Segoe UI', sans-serif; font-weight: 600; font-size: 17pt; letter-spacing: 1.5pt; }
.cover .logo { width: 14mm; height: 14mm; display: block; }
.cover .k { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 2pt; color: #b3261e; }
.cover h1 { font-size: 38pt; font-weight: 300; line-height: 1.05; margin: 2mm 0 6mm; letter-spacing: -0.5pt; }
.cover .hh { font-size: 13pt; font-weight: 600; }
.cover .addr { font-size: 10.5pt; color: #444; margin-top: 1mm; }
.cover .foot { position: absolute; left: 22mm; right: 22mm; bottom: 18mm; display: flex; justify-content: space-between; align-items: flex-end; border-top: 0.75pt solid #1b1b1b; padding-top: 3mm; font-size: 8.5pt; color: #444; }
.cover .foot b { display: block; font-size: 15pt; color: #b3261e; }

/* Contents */
.toc { margin: 0 0 2mm; }
.toc h2 { margin-top: 0; }
.toc ol { column-count: 3; column-gap: 6mm; margin: 0; padding: 0; list-style: none; font-size: 8.5pt; }
.toc li { display: flex; gap: 1mm; margin: 0.4mm 0; }
.toc li .n { color: #b3261e; font-weight: 700; width: 5mm; flex: none; }
.toc li.top { font-weight: 600; margin-top: 1.2mm; }
.toc li.sub { padding-left: 5mm; font-size: 7.5pt; color: #444; }
.toc li .dots { flex: 1; border-bottom: 0.6pt dotted #9a9a9a; margin-bottom: 1.1mm; min-width: 2mm; }

/* Summary */
.sos { display: flex; flex-wrap: wrap; background: #fbeeed; border-left: 2.5mm solid #b3261e; margin: 0 0 3mm; }
.sos div { padding: 1.6mm 4mm; border-right: 0.4pt solid #ecc9c6; }
.sos div:last-child { border-right: 0; }
.sos span { display: block; font-size: 6.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6pt; color: #8f1d17; }
.sos b { font-size: 11pt; }
.sos div:first-child b { font-size: 17pt; color: #b3261e; }

/* Wallet cards: dashed lines are cutting guides */
.card { width: 85mm; border: 0.75pt dashed #777; padding: 2.5mm; font-size: 8pt; display: inline-block; vertical-align: top; margin: 0 3mm 3mm 0; break-inside: avoid; }
.card .ct { display: block; font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8pt; color: #b3261e; margin-bottom: 0.5mm; }
.card td { font-size: 7.5pt; padding: 0.4mm 1mm 0.4mm 0; }
.card .carer { border-left: 1.5mm solid #b3261e; background: #fbeeed; padding: 1mm 1.5mm; margin: 1mm 0; }
.card .carer table { margin: 0.5mm 0 0; }
.card .carer td { border-bottom-color: #ecc9c6; }
.footer { margin-top: 6mm; font-size: 7.5pt; color: #5f6368; }
@media screen { body { padding: 10mm; background: #fff; } .cover { margin: -10mm -10mm 10mm; box-shadow: 0 0 0 1px #ddd; } }
`;

// Columns with nothing in any row are left out, so sparse tables stay narrow and readable.
function tbl(cols, rows, empty = 'Nothing recorded yet') {
  if (!rows.length) return `<p class="empty">${empty}</p>`;
  const val = (c, r) => (c.get ? c.get(r) : r[c.key]);
  const used = cols.filter((c, i) => i === 0 || c.keep || rows.some((r) => { const v = val(c, r); return v != null && String(v).trim() !== ''; }));
  return `<table><thead><tr>${used.map((c) => `<th${c.w ? ` style="width:${c.w}"` : ''}${c.cls ? ` class="${c.cls}"` : ''}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${used.map((c) => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.raw ? val(c, r) ?? '' : esc(val(c, r))}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

const LOGO = '<svg class="logo" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="240" height="240" rx="44" fill="#b3261e"/><path d="M128 40 L216 116 L216 210 L40 210 L40 116 Z" fill="none" stroke="#fff" stroke-width="18" stroke-linejoin="round"/><rect x="113" y="104" width="30" height="86" fill="#fff"/><rect x="85" y="132" width="86" height="30" fill="#fff"/></svg>';

// Address lines without trailing commas, plus the postcode when the address does not already include it.
function addressLines(hh) {
  const lines = String(hh.address || '').split('\n').map((l) => l.trim().replace(/,+$/, '')).filter(Boolean);
  const pc = String(hh.postcode || '').trim();
  if (pc && !lines.some((l) => l.toUpperCase().includes(pc.toUpperCase()))) lines.push(pc);
  return lines;
}

function cover() {
  const hh = store.get('household');
  const addr = addressLines(hh).join(', ');
  return `<div class="cover">${hexField(210, 175, 9)}
    <div class="title"><div class="brand">${LOGO}HOLDFAST</div>
      <div class="k">Keep this somewhere everyone can find it</div>
      <h1>Household<br>Emergency Plan</h1>
      ${hh.name ? `<div class="hh">${esc(hh.name)}</div>` : ''}
      ${addr ? `<div class="addr">${esc(addr)}</div>` : ''}
    </div>
    <div class="foot"><div>In an emergency call<b>999 or 112</b></div><div style="text-align:right">Printed ${fmtDate(new Date().toISOString())}<br>Review every 6 months</div></div>
  </div>`;
}

const nonEmpty = (rows, keys) => rows.filter((r) => keys.some((k) => r[k] != null && String(r[k]).trim() !== ''));

// title: name in the contents and the section heading.
// sub: entries listed under the section in the contents, each { id, title } of an element inside it.
export const SECTIONS = [
  { id: 'summary', title: 'Our household', label: 'Summary page (address, people, key numbers)', build: summary },
  { id: 'contacts', title: 'Contacts', label: 'Contacts and national numbers', build: contacts },
  { id: 'people', title: 'People and pets', label: 'People, medical details and pets', build: people },
  { id: 'medications', title: 'Medications', label: 'Medications', build: medications },
  { id: 'locations', title: 'Key locations', label: 'Key locations (stopcock, meters, kit)', build: locations },
  { id: 'utilities', title: 'Utilities and accounts', label: 'Utilities and accounts', build: utilities },
  { id: 'meeting', title: 'Meeting points and routes', label: 'Meeting points and routes', build: meeting },
  { id: 'scenarios', title: 'Scenario plans', label: 'Scenario plans', build: scenarios, sub: () => store.get('scenarios').map((s) => ({ id: 'sc-' + s.id, title: s.name })) },
  { id: 'documents', title: 'Documents register', label: 'Documents register', build: documents },
  { id: 'radio', title: 'Radio frequencies', label: 'Radio frequencies', build: radio },
  { id: 'supplies', title: 'Supplies and stock', label: 'Supplies and stock', build: supplies },
  { id: 'checklists', title: 'Checklists', label: 'Checklists', build: checklists, sub: (opts) => chosenChecklists(opts).map((c) => ({ id: 'cl-' + c.id, title: c.name })) },
  { id: 'kit', title: 'First aid kit', label: 'First aid kit inventory', build: kit },
  { id: 'firstaid', title: 'First aid', label: 'First aid guides', build: firstaid, sub: (opts) => chosenGuides(opts).map((g) => ({ id: 'fa-' + g.id, title: g.title })) },
  { id: 'cards', title: 'Wallet cards', label: 'Wallet cards (cut out)', build: cards },
];

const chosenChecklists = (opts) => store.get('checklists').filter((c) => !opts.checklistIds || opts.checklistIds.includes(c.id));
const chosenGuides = (opts) => GUIDES.filter((g) => !opts.guideIds || opts.guideIds.includes(g.id));

function summary() {
  const hh = store.get('household');
  const ice = store.get('contacts').filter((c) => c.ice || c.category === 'Out-of-area contact').filter((c) => c.name || c.phone);
  const mp = nonEmpty(store.get('meeting'), ['name', 'address']);
  return `<h2>Our household</h2>
  <div class="sos"><div><span>Emergency</span><b>999 or 112</b></div><div><span>NHS advice</span><b>111</b></div><div><span>Power cut</span><b>105</b></div><div><span>Gas leak</span><b>0800 111 999</b></div><div><span>Floodline</span><b>0345 988 1188</b></div></div>
  <div class="cols">
    <div>
      <h3>Address</h3>
      <p>${addressLines(hh).map(esc).join('<br>')}</p>
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
  return `<h2>Scenario plans</h2><div class="twocol">` + store.get('scenarios').map((s) => `
    <div class="guide" id="sc-${esc(s.id)}"><h3>${esc(s.name)}</h3>
    ${s.trigger ? `<p><b>When:</b> ${esc(s.trigger)}</p>` : ''}${s.owner ? `<p><b>Who:</b> ${esc(s.owner)}</p>` : ''}
    <ol>${s.steps.map((t) => (typeof t === 'string' ? { text: t } : t)).map((t) => `<li>${esc(t.text)}${t.who ? ` <i>(${esc(t.who)})</i>` : ''}</li>`).join('')}</ol>
    ${s.notes ? `<p>${esc(s.notes)}</p>` : ''}</div>`).join('') + '</div>';
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
  return '<h2>Checklists</h2>' + chosenChecklists(opts).map((c) => `
    <h3 id="cl-${esc(c.id)}">${esc(c.name)}</h3>
    ${tbl([{ label: '', raw: true, get: (r) => `<i>${r.done ? '&#10003;' : ''}</i>`, cls: 'tick' }, { label: 'Item', key: 'text', keep: true }, { label: 'Qty / detail', key: 'qty', w: '22%' }, { label: 'Notes', key: 'note', w: '25%' }], c.items)}`).join('');
}

function kit() {
  return `<h2>First aid kit</h2>
  ${tbl([{ label: 'Item', key: 'item' }, { label: 'Have', key: 'qty' }, { label: 'Target', key: 'target' }, { label: 'Expiry', get: (r) => fmtDate(r.expiry) }, { label: 'Location', key: 'location' }, { label: 'Notes', key: 'notes' }], store.get('firstAidKit'))}`;
}

export function guideHtml(g) {
  return `<div class="guide" id="fa-${esc(g.id)}">
    <h3>${esc(g.title)}<span class="sev sev-${esc(g.sev)}">${esc(SEVERITY[g.sev].label)}</span></h3>
    <p class="lead">${esc(g.summary)}</p>
    <ol>${g.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    ${g.call && g.call.length ? `<p class="sub">Get help</p><ul>${g.call.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    ${g.dont && g.dont.length ? `<p class="sub">Do not</p><ul>${g.dont.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    ${g.notes ? `<p>${esc(g.notes)}</p>` : ''}
    <p class="meta">Source: ${g.src.map((s) => SOURCES[s].name).join(', ')}</p></div>`;
}

function firstaid(opts) {
  return `<h2>First aid</h2>
  <p class="meta">Summary guidance from NHS, St John Ambulance, British Red Cross and Resuscitation Council UK. Not a substitute for training. In an emergency call 999.</p>
  <div class="twocol">${chosenGuides(opts).map(guideHtml).join('')}</div>`;
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
    <span class="ct">Emergency card</span><b>${p ? esc(p.name) : 'Household'}</b>${p && p.role ? ` <span class="meta">(${esc(p.role)})</span>` : ''}<br>
    ${idLine.length ? esc(idLine.join(', ')) + '<br>' : ''}
    ${esc(addressLines(hh).slice(0, 1).concat(hh.postcode || []).filter((x, i, a) => a.indexOf(x) === i).join(', '))}<br>
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

// The main process fills in the page numbers after a first layout pass:
// each <!--pg:id-->...<!--/pg--> becomes the page the element with that id lands on.
function contents(chosen, opts) {
  const entry = (id, title, cls, n) => `<li class="${cls}">${n ? `<span class="n">${n}</span>` : ''}<a href="#${id}">${esc(title)}</a><span class="dots"></span><!--pg:${id}-->&ndash;<!--/pg--></li>`;
  return `<nav class="toc"><h2>Contents</h2><ol>${chosen.map((s, i) => entry('sec-' + s.id, s.title, 'top', String(i + 1).padStart(2, '0'))
    + (s.sub ? s.sub(opts).map((x) => entry(x.id, x.title, 'sub')).join('') : '')).join('')}</ol></nav>`;
}

// opts: { checklistIds, guideIds, pageBreaks: each section on a new page, cover: false to leave out the cover page }
export function buildDocument(sectionIds, opts = {}) {
  const chosen = SECTIONS.filter((s) => sectionIds.includes(s.id));
  const parts = chosen.map((s, i) => `<section id="sec-${s.id}"${i && opts.pageBreaks ? ' class="pb"' : ''}>${s.build(opts)}</section>`);
  const hh = store.get('household');
  const full = chosen.length > 1;
  const head = full && opts.cover !== false ? cover()
    : `<div class="mast"><div><div class="k">Household emergency plan</div><div class="t">${esc(hh.name || 'Our household')}</div></div><div class="meta">Printed ${fmtDate(new Date().toISOString(), true)}</div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Emergency Plan</title><style>${CSS}</style></head><body>
  ${head}${full || chosen.some((s) => s.sub) ? contents(chosen, opts) : ''}${parts.join('')}
  <div class="footer">Made with Holdfast Emergency Preparation System. Review it every six months and after any big change.</div></body></html>`;
}
