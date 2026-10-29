import * as store from './lib/store.js';
import { h, status, icon, fmtDate, messageBox } from './lib/ui.js';

const PAGES = [
  { group: 'Overview' },
  { id: 'dashboard', icon: 'view-dashboard-outline', label: 'Dashboard', mod: './pages/dashboard.js' },
  { group: 'Plan' },
  { id: 'planner', icon: 'clipboard-text-outline', label: 'Emergency Planner', mod: './pages/planner.js' },
  { id: 'contacts', icon: 'card-account-phone-outline', label: 'Contacts and Numbers', mod: './pages/contacts.js' },
  { id: 'supplies', icon: 'package-variant-closed', label: 'Supplies and Stock', mod: './pages/supplies.js' },
  { id: 'checklists', icon: 'format-list-checks', label: 'Checklists', mod: './pages/checklists.js' },
  { id: 'vault', icon: 'safe-square-outline', label: 'Document Vault', mod: './pages/vault.js' },
  { group: 'Reference' },
  { id: 'firstaid', icon: 'medical-bag', label: 'First Aid', mod: './pages/firstaid.js' },
  { id: 'library', icon: 'bookshelf', label: 'Offline Library', mod: './pages/library.js' },
  { id: 'radio', icon: 'radio-handheld', label: 'Radio Frequencies', mod: './pages/radio.js' },
  { group: 'Situation' },
  { id: 'maps', icon: 'map-outline', label: 'Maps', mod: './pages/maps.js', fill: true },
  { id: 'weather', icon: 'weather-partly-rainy', label: 'Weather and Warnings', mod: './pages/weather.js' },
  { id: 'tools', icon: 'calculator-variant-outline', label: 'Calculators', mod: './pages/tools.js' },
  { group: 'System' },
  { id: 'print', icon: 'printer-outline', label: 'Print Centre', mod: './pages/print.js', fill: true },
  { id: 'usb', icon: 'usb-flash-drive-outline', label: 'USB Backup', mod: './pages/usb.js' },
  { id: 'settings', icon: 'cog-outline', label: 'Settings and Data', mod: './pages/settings.js' },
];

let current = null;
let cleanup = null;

function buildNav() {
  const list = document.getElementById('navlist');
  let n = 0;
  list.replaceChildren(...PAGES.map((p) => {
    if (p.group) return h('div', { class: 'navgroup' }, p.group);
    n++;
    return h('div', { class: 'navitem', dataset: { id: p.id }, onclick: () => go(p.id) }, icon(p.icon), p.label, n <= 9 ? h('span', { class: 'key' }, 'Ctrl+' + n) : null);
  }));
}

// Each navigation gets a number; a page that finishes loading after a newer navigation started is thrown away.
let navSeq = 0;

export async function go(id, params) {
  const seq = ++navSeq;
  const p = PAGES.find((x) => x.id === id) || PAGES[1];
  if (cleanup) {
    try { cleanup(); } catch (e) { console.error(e); }
    cleanup = null;
  }
  current = p.id;
  location.hash = p.id;
  document.querySelectorAll('.navitem').forEach((el) => el.classList.toggle('active', el.dataset.id === p.id));
  document.getElementById('pagetitle').textContent = p.label;
  const page = document.getElementById('page');
  page.className = p.fill ? 'fill' : '';
  page.replaceChildren();
  page.scrollTop = 0;
  // Pages render into their own element, which only goes on screen if this is still the latest navigation.
  const target = h('div', { style: 'display:contents' });
  try {
    const mod = await import(p.mod);
    if (seq !== navSeq) return;
    page.replaceChildren(target);
    const done = (await mod.render(target, params || {})) || null;
    if (seq !== navSeq) {
      if (done) try { done(); } catch (e) { console.error(e); }
      return;
    }
    cleanup = done;
  } catch (e) {
    console.error(e);
    if (seq === navSeq) page.replaceChildren(h('div', { class: 'note warn' }, 'Error loading page: ' + e.message));
  }
}
window.go = go;

function netState() {
  const el = document.getElementById('netstate');
  const offlineMode = store.settings().offlineMode;
  if (offlineMode) {
    el.className = 'pill warn';
    el.textContent = 'OFFLINE MODE';
  } else if (navigator.onLine) {
    el.className = 'pill ok';
    el.textContent = 'Online';
  } else {
    el.className = 'pill bad';
    el.textContent = 'No connection';
  }
}
window.refreshNetState = netState;

function footer() {
  const hh = store.get('household');
  document.getElementById('navfoot').replaceChildren(
    h('div', null, h('b', null, hh.name || 'Household'), hh.postcode ? ' ' + hh.postcode : ''),
    h('div', null, icon('phone-alert'), ' Emergency: ', h('b', null, '999'), '  Non-urgent: ', h('b', null, '111')));
}
window.refreshFooter = footer;

// A backup drive that was edited on another computer is plugged in.
let syncList = [];
function syncNote(list) {
  syncList = list || [];
  usbDrives();
  const el = document.getElementById('syncnote');
  const d = list && list[0];
  el.replaceChildren(d ? h('button', { class: 'syncnote', title: 'The copy of the program on this drive was used on another computer', onclick: () => go('usb', { review: d.drive }) },
    icon('usb-flash-drive-outline'), `${d.drive} has ${d.usbChanges ? d.usbChanges + ' change(s)' : 'changes'} from another computer. Review`) : '');
}

// Holdfast backup drives that are plugged in, shown at the bottom of the sidebar with an eject button.
let presentList = [];
const ejecting = new Set();
function usbDrives(list) {
  if (list) presentList = list;
  document.getElementById('navusb').replaceChildren(...presentList.map((d) => {
    const changes = syncList.find((x) => x.drive === d.drive);
    const busy = ejecting.has(d.drive);
    return h('div', { class: 'usbitem' + (changes ? ' changed' : ''), title: 'Open USB Backup for this drive', onclick: () => go('usb', { drive: d.drive }) },
      icon('usb-flash-drive'),
      h('div', { class: 't' }, h('b', null, `Holdfast drive (${d.drive})`),
        h('small', null, busy ? 'Ejecting...' : changes ? 'Has changes from another PC' : d.complete ? 'Backup ' + fmtDate(d.created) : 'Unfinished backup')),
      h('button', { class: 'eject', title: 'Eject so it is safe to remove', disabled: busy, onclick: (e) => { e.stopPropagation(); ejectDrive(d.drive); } }, icon('eject')));
  }));
}

export async function ejectDrive(drive) {
  ejecting.add(drive);
  usbDrives();
  status(`Ejecting ${drive}...`, 0);
  try {
    await window.api.usb.eject(drive);
    status(`${drive} ejected`);
    presentList = presentList.filter((d) => d.drive !== drive);
    await messageBox('Safe to remove hardware', `The Holdfast drive (${drive}) can now be safely removed from the computer.`, 'check-circle-outline');
    return true;
  } catch (e) {
    status('');
    await messageBox('Could not eject', String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'alert-outline');
    return false;
  } finally {
    ejecting.delete(drive);
    usbDrives();
  }
}
window.ejectDrive = ejectDrive;

function applyTheme() {
  const t = store.settings().theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
window.applyTheme = applyTheme;

// Version 1 pre-filled tables with blank starter rows. Remove any the user never edited;
// they are now offered through "Add suggestions" instead.
function removeUntouchedStarterRows(suggestions) {
  const blank = (v) => v == null || v === '';
  const same = (row, sug) => {
    const keys = new Set([...Object.keys(row), ...Object.keys(sug)]);
    keys.delete('id');
    return [...keys].every((k) => (blank(row[k]) && blank(sug[k])) || row[k] === sug[k]);
  };
  for (const [key, sugs] of Object.entries(suggestions)) {
    const rows = store.get(key);
    const kept = rows.filter((r) => !sugs.some((sg) => same(r, sg)));
    if (kept.length !== rows.length) store.set(key, kept);
  }
}

async function boot() {
  await store.init();
  // Fill in any settings added in later versions.
  const s = store.settings();
  const { DEFAULTS, SUGGESTIONS } = await import('./data/defaults.js');
  const needsV2 = !('dataVersion' in s);
  for (const [k, v] of Object.entries(DEFAULTS.settings)) if (!(k in s)) s[k] = v;
  if (needsV2) removeUntouchedStarterRows(SUGGESTIONS);
  // Earlier versions could save 0 here by clearing the box in Settings.
  for (const k of ['targetDays', 'waterPerPersonDay', 'reviewIntervalMonths', 'keepVersions']) if (!(Number(s[k]) > 0)) s[k] = DEFAULTS.settings[k];
  store.save('settings');

  applyTheme();
  buildNav();
  footer();
  netState();
  window.addEventListener('online', netState);
  window.addEventListener('offline', netState);
  window.api.on('nav', (id) => go(id));
  window.api.on('usb:sync-status', syncNote);
  window.api.usb.syncStatus().then(syncNote, () => {});
  window.api.on('usb:present', usbDrives);
  window.api.usb.present().then(usbDrives, () => {});
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      const items = PAGES.filter((p) => p.id);
      const p = items[Number(e.key) - 1];
      if (p) {
        e.preventDefault();
        go(p.id);
      }
    }
  });
  window.api.app.info().then((i) => (document.getElementById('statusright').textContent = 'v' + i.version + '  |  Data: ' + i.dataRoot));
  go((location.hash || '').slice(1) || 'dashboard');
  status('Ready');
}

boot();
