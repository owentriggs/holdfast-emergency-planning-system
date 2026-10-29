// Three-way merge of plan data between this computer (pc) and a backup drive (usb), against the data as it was
// at the last backup (base). Lists of rows are matched by id and merged field by field, so an edit to a phone
// number on one side and an email on the other both survive.
//
// Each difference becomes a change { id, kind, label, pc, usb, choice }:
//   usb       changed on the drive only        default: take the drive's version
//   pc        changed on this computer only    kept, not listed (it goes to the drive on the next backup)
//   conflict  changed on both                  default: keep this computer's version
//   only-usb / only-pc   no base to compare (backup made before sync existed)   default: keep what exists
// choices: { [change id]: 'pc' | 'usb' } overrides the defaults.

const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const eq = (a, b) => canon(a) === canon(b);
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const isRows = (v) => Array.isArray(v) && v.length > 0 && v.every((r) => isObj(r) && r.id != null);

const KEY_LABELS = {
  household: 'Household', contacts: 'Contacts', supplies: 'Supplies', checklists: 'Checklists', locations: 'Key locations', utilities: 'Utilities',
  meeting: 'Meeting points', routes: 'Routes', documents: 'Documents register', medications: 'Medications', scenarios: 'Scenario plans',
  firstAidKit: 'First aid kit', radio: 'Radio', markers: 'Map markers', reviewLog: 'Review log', vault: 'Document vault', people: 'People', pets: 'Pets', files: 'Files',
};
// Field names that do not read well when split from camelCase. Others become "Property type" from "propertyType".
const FIELD_LABELS = {
  lat: 'Map position (latitude)', lon: 'Map position (longitude)', dob: 'Date of birth', nhs: 'NHS number', psr: 'Priority Services Register',
  gridRef: 'OS grid ref', what3words: 'what3words', perPersonDay: 'Use per person per day', qty: 'Quantity', ice: 'ICE contact',
  altPhone: 'Alt phone', carer1: 'Parent / carer', carer2: 'Second carer', blood: 'Blood group', needs: 'Support needs', howTo: 'How to',
};
const fieldLabel = (k) => KEY_LABELS[k] || FIELD_LABELS[k] || (/^[a-z][a-zA-Z0-9]*$/.test(k) ? k.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : k);
const blank = (v) => v === undefined || v === null || v === '';

// Not merged: window size and similar per-computer settings, and the library index (managed with its files).
const SKIP_KEYS = new Set(['settings', 'webcache']);

const rowLabel = (r) => (r && (r.name || r.item || r.title || r.document || r.service || r.type || r.text || r.drug || r.label)) || 'row';

function merge(b, p, u, at, st) {
  if (eq(p, u)) return p;
  const arrays = [p, u].every((x) => x === undefined || Array.isArray(x));
  if (arrays && [b, p, u].some(isRows) && [b, p, u].every((x) => x === undefined || x.length === 0 || isRows(x))) return mergeRows(b || [], p || [], u || [], at, st);
  if (isObj(p) && isObj(u)) {
    const out = {};
    for (const k of new Set([...Object.keys(p), ...Object.keys(u)])) {
      const v = merge(isObj(b) ? b[k] : undefined, p[k], u[k], [...at, { k, label: fieldLabel(k) }], st);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return decide(b, p, u, at, st);
}

function mergeRows(b, p, u, at, st) {
  const byId = (rows) => new Map(rows.map((r) => [String(r.id), r]));
  const B = byId(b), P = byId(p), U = byId(u);
  const ids = [...P.keys(), ...[...U.keys()].filter((id) => !P.has(id))];
  const out = [];
  for (const id of ids) {
    const step = [...at, { k: id, label: rowLabel(P.get(id) || U.get(id)) }];
    const pr = P.get(id), ur = U.get(id);
    const v = pr && ur ? merge(B.get(id), pr, ur, step, st) : decide(B.get(id), pr, ur, step, st);
    if (v !== undefined) out.push(v);
  }
  return out;
}

function decide(b, p, u, at, st) {
  let kind;
  // With no base, a value filled in on one side and blank on the other was most likely added there, not changed on both.
  if (!st.hasBase && blank(p) && blank(u)) return p;
  if (!st.hasBase) kind = blank(p) ? 'only-usb' : blank(u) ? 'only-pc' : 'conflict';
  else if (eq(p, b)) kind = 'usb';
  else if (eq(u, b)) kind = 'pc';
  else kind = 'conflict';
  if (kind === 'pc') { st.pcChanges++; st.pcList.push({ label: at.map((a) => a.label), was: b, now: p }); return p; }
  const id = at.map((a) => a.k).join('/');
  const def = kind === 'usb' || kind === 'only-usb' ? 'usb' : 'pc';
  const choice = st.choices[id] || def;
  st.changes.push({ id, kind, label: at.map((a) => a.label), pc: p, usb: u, choice });
  return choice === 'usb' ? u : p;
}

// base, pc, usb: { key: value }. Returns { result, changed: [keys], changes, pcChanges, pcList }.
// pcList: the changes made on this computer only, each { label, was, now }.
function mergePlan(base, pc, usb, choices = {}, opts = {}) {
  const st = { hasBase: !!base, choices, changes: [], pcChanges: 0, pcList: [] };
  const result = {};
  const changed = [];
  for (const k of new Set([...Object.keys(pc), ...Object.keys(usb)])) {
    // A missing file on the drive means "never written there", not "deleted".
    if ((SKIP_KEYS.has(k) && !opts.all) || !(k in usb)) { result[k] = pc[k]; continue; }
    const v = merge(base ? base[k] : undefined, pc[k], usb[k], [{ k, label: KEY_LABELS[k] || k }], st);
    result[k] = v;
    if (!eq(v, pc[k])) changed.push(k);
  }
  return { result, changed, changes: st.changes, pcChanges: st.pcChanges, pcList: st.pcList };
}

module.exports = { mergePlan, eq, SKIP_KEYS };
