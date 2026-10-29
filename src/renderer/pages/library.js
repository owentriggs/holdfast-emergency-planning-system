import * as store from '../lib/store.js';
import { h, panel, status, fmtDate, fmtBytes, promptForm, confirmBox, daysUntil, icon } from '../lib/ui.js';
import { WEB_PRESETS } from '../data/defaults.js';

let view = 'list';
let openId = null;
let openVersion = null;
let live = false;
const selected = new Set();
let groupFilter = '';
let query = '';
let linked = { on: false, max: 10 };

const norm = (u) => { try { const x = new URL(u); x.hash = ''; return x.toString().replace(/\/$/, ''); } catch (e) { return u; } };

export function render(root) {
  const offs = [];
  const progressEl = h('div', { class: 'progress' }, h('i'));
  const progText = h('span', { class: 'muted' });

  offs.push(window.api.on('webcache:progress', (p) => {
    if (p.state === 'finished') {
      progressEl.firstChild.style.width = '0';
      progText.textContent = '';
      status('Capture finished');
      return;
    }
    progressEl.firstChild.style.width = `${(p.done / Math.max(1, p.total)) * 100}%`;
    progText.textContent = `${p.state === 'capturing' ? 'Capturing' : p.state === 'error' ? 'Failed' : 'Saved'} ${p.done}/${p.total}: ${p.url}${p.error ? ' (' + p.error + ')' : ''}`;
  }));
  offs.push(store.onChange((k) => { if (k === 'webcache' && view === 'list') draw(); }));
  offs.push(window.api.on('viewer:open-request', (url) => openUrl(url)));

  async function capture(ids) {
    if (!ids.length) return status('Nothing selected');
    if (!navigator.onLine) return status('No internet connection');
    try {
      const res = await window.api.webcache.capture(ids, linked.on ? { linked: { maxPages: linked.max } } : {});
      const ok = res.filter((r) => r.ok).length;
      const changed = res.filter((r) => r.changed).length;
      status(`${ok} of ${res.length} captured. ${changed} changed since last capture.`, 10000);
    } catch (e) {
      status('Capture failed: ' + e.message, 10000);
    }
  }

  async function openUrl(url) {
    const it = store.get('webcache').find((x) => norm(x.url) === norm(url) && x.file);
    if (it) {
      openId = it.id; openVersion = null; live = false; view = 'viewer';
      return draw();
    }
    const v = await promptForm('Page not in offline library', [
      { key: 'action', label: url, type: 'select', options: [
        { value: 'add', label: 'Add to library and capture now' },
        { value: 'live', label: 'Open live in the viewer' },
        { value: 'browser', label: 'Open in system browser' },
      ] },
    ], 'Go');
    if (!v) return;
    if (v.action === 'browser') return window.api.app.openExternal(url);
    if (v.action === 'live') {
      const wv = root.querySelector('webview');
      if (wv) { live = true; wv.src = url; }
      return;
    }
    const cur = store.get('webcache').find((x) => x.id === openId);
    const [added] = await window.api.webcache.add([{ url, group: cur ? cur.group : 'General', parentId: cur ? cur.id : null }]);
    if (added) {
      await capture([added.id]);
      openId = added.id; view = 'viewer'; live = false; draw();
    }
  }

  function draw() {
    root.replaceChildren(view === 'viewer' ? viewer() : list());
  }

  function list() {
    const items = store.get('webcache');
    const groups = [...new Set(items.map((i) => i.group))].sort();
    const q = query.toLowerCase();
    const shown = items.filter((i) => (!groupFilter || i.group === groupFilter) && (!q || (i.title + ' ' + i.url + ' ' + (i.notes || '')).toLowerCase().includes(q)));
    for (const id of [...selected]) if (!items.find((i) => i.id === id)) selected.delete(id);

    const captured = items.filter((i) => i.file).length;
    const stale = items.filter((i) => i.lastCaptured && -daysUntil(i.lastCaptured.slice(0, 10)) > 30).length;
    const errors = items.filter((i) => /^error/.test(i.status)).length;
    const changed = items.filter((i) => i.changed).length;
    const bytes = items.reduce((a, i) => a + (i.versions || []).reduce((b, v) => b + (v.size || 0), 0), 0);

    const allBox = h('input', { type: 'checkbox', checked: shown.length && shown.every((i) => selected.has(i.id)), onchange: (e) => { shown.forEach((i) => (e.target.checked ? selected.add(i.id) : selected.delete(i.id))); draw(); } });

    const rows = shown.map((it) => {
      const age = it.lastCaptured ? -daysUntil(it.lastCaptured.slice(0, 10)) : null;
      return h('tr', { class: /^error/.test(it.status) ? 'bad' : '', style: 'cursor:pointer', ondblclick: () => { if (it.file) { openId = it.id; openVersion = null; live = false; view = 'viewer'; draw(); } } },
        h('td', { onclick: (e) => e.stopPropagation() }, h('input', { type: 'checkbox', checked: selected.has(it.id), onchange: (e) => { e.target.checked ? selected.add(it.id) : selected.delete(it.id); } })),
        h('td', null, it.parentId ? icon('subdirectory-arrow-right', 'muted') : null, h('a', { href: '#', onclick: (e) => { e.preventDefault(); if (it.file) { openId = it.id; openVersion = null; live = false; view = 'viewer'; draw(); } else status('Not captured yet. Select it and click Capture.'); } }, it.title || it.url),
          it.changed ? h('span', { class: 'pill info', style: 'margin-left:6px' }, 'changed') : null),
        h('td', null, it.group),
        h('td', { class: 'muted small' }, it.url),
        h('td', null, it.type ? it.type.toUpperCase() : ''),
        h('td', null, it.file ? (/^error/.test(it.status) ? h('span', { class: 'pill warn', title: it.status }, 'old copy, last update failed') : h('span', { class: 'pill ok' }, 'cached')) : /^error/.test(it.status) ? h('span', { class: 'pill bad', title: it.status }, 'failed') : h('span', { class: 'pill' }, 'not captured')),
        h('td', { class: 'nowrap' }, fmtDate(it.lastCaptured, true)),
        h('td', { class: 'num ' + (age > 90 ? '' : '') }, age == null ? '' : h('span', { style: age > 90 ? 'color:var(--red)' : age > 30 ? 'color:var(--amber)' : '' }, age + ' d')),
        h('td', { class: 'num' }, it.size ? fmtBytes(it.size) : ''),
        h('td', { class: 'num' }, (it.versions || []).length || ''));
    });

    return h('div', { class: 'stack' },
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'v' }, items.length), h('div', { class: 'l' }, 'Pages in library')),
        h('div', { class: 'stat ' + (captured === items.length ? 'ok' : 'warn') }, h('div', { class: 'v' }, captured), h('div', { class: 'l' }, 'Available offline')),
        h('div', { class: 'stat ' + (stale ? 'warn' : 'ok') }, h('div', { class: 'v' }, stale), h('div', { class: 'l' }, 'Older than 30 days')),
        h('div', { class: 'stat ' + (errors ? 'bad' : 'ok') }, h('div', { class: 'v' }, errors), h('div', { class: 'l' }, 'Last update failed')),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, changed), h('div', { class: 'l' }, 'Changed at last update')),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, fmtBytes(bytes)), h('div', { class: 'l' }, 'Disk used'))),
      panel('Offline library', h('div', null,
        h('div', { class: 'tbltools' },
          h('button', { onclick: async () => {
            const v = await promptForm('Add web page', [
              { key: 'url', label: 'URL', placeholder: 'https://...' },
              { key: 'title', label: 'Title (optional)' },
              { key: 'group', label: 'Group', value: groupFilter || 'General' },
              { key: 'now', label: 'Capture now', type: 'select', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No, later' }] },
            ], 'Add');
            if (!v || !v.url) return;
            const added = await window.api.webcache.add([{ url: v.url, title: v.title, group: v.group || 'General' }]);
            if (!added.length) return status('Already in the library, or not a valid URL');
            if (v.now === 'yes') capture(added.map((a) => a.id));
          } }, icon('plus'), 'Add page'),
          h('button', { onclick: async () => {
            const existing = new Set(store.get('webcache').map((i) => norm(i.url)));
            const missing = WEB_PRESETS.filter((p) => !existing.has(norm(p.url)));
            if (!missing.length) return status('All presets are already in the library');
            if (!(await confirmBox(`Add ${missing.length} preset pages (GOV.UK Be Ready, Welsh Government, NHS, St John Ambulance, British Red Cross, Met Office, flood services)?`, 'Add'))) return;
            const added = await window.api.webcache.add(missing);
            if (navigator.onLine && (await confirmBox(`Added ${added.length}. Capture them now?`, 'Capture now'))) capture(added.map((a) => a.id));
          } }, icon('playlist-plus'), 'Add presets'),
          h('span', { style: 'width:10px' }),
          h('button', { class: 'primary', onclick: () => capture([...selected]) }, icon('cloud-download-outline'), 'Capture / update selected'),
          h('button', { onclick: () => capture(items.map((i) => i.id)) }, icon('refresh'), 'Update all'),
          h('button', { onclick: () => capture(items.filter((i) => !i.file || /^error/.test(i.status) || -daysUntil((i.lastCaptured || '2000-01-01').slice(0, 10)) > 30).map((i) => i.id)) }, icon('update'), 'Update stale and missing'),
          h('button', { onclick: () => window.api.webcache.cancel() }, icon('stop'), 'Stop'),
          h('label', { class: 'chk', title: 'Also save pages linked from each page (same website only)' },
            h('input', { type: 'checkbox', checked: linked.on, onchange: (e) => (linked.on = e.target.checked) }), 'Include linked pages, max',
            h('input', { type: 'number', value: linked.max, min: 1, max: 50, style: 'width:50px', oninput: (e) => (linked.max = Number(e.target.value) || 10) })),
          h('span', { class: 'spacer' }),
          h('button', { onclick: async () => {
            const it = items.find((i) => selected.has(i.id));
            if (!it) return status('Select one page to edit');
            const v = await promptForm('Edit page', [
              { key: 'title', label: 'Title', value: it.title }, { key: 'group', label: 'Group', value: it.group },
              { key: 'url', label: 'URL', value: it.url }, { key: 'notes', label: 'Notes', type: 'textarea', value: it.notes },
            ], 'Save');
            if (v) await window.api.webcache.update(it.id, v);
          } }, icon('pencil-outline'), 'Edit'),
          h('button', { class: 'danger', onclick: async () => {
            if (!selected.size) return;
            if (!(await confirmBox(`Remove ${selected.size} page(s) and their saved copies?`, 'Remove', true))) return;
            await window.api.webcache.remove([...selected]);
            selected.clear();
          } }, icon('delete-outline'), 'Remove'),
          h('button', { onclick: () => window.api.webcache.openFolder() }, icon('folder-open-outline'), 'Open folder')),
        h('div', { class: 'tbltools' },
          h('input', { type: 'search', placeholder: 'Filter...', value: query, oninput: (e) => { query = e.target.value; clearTimeout(list.t); list.t = setTimeout(draw, 250); } }),
          h('select', { onchange: (e) => { groupFilter = e.target.value; draw(); } }, h('option', { value: '' }, 'All groups'), groups.map((g) => h('option', { selected: g === groupFilter }, g))),
          progText, h('span', { class: 'spacer' })),
        progressEl,
        h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', { style: 'width:24px' }, allBox), h('th', null, 'Title'), h('th', null, 'Group'), h('th', null, 'URL'), h('th', null, 'Type'), h('th', null, 'Status'), h('th', null, 'Captured'), h('th', { class: 'num' }, 'Age'), h('th', { class: 'num' }, 'Size'), h('th', { class: 'num' }, 'Versions'))),
          h('tbody', null, rows.length ? rows : h('tr', { class: 'empty' }, h('td', { colspan: 10 }, items.length ? 'No matching pages' : 'Library is empty. Click "Add presets" to add useful UK and Wales pages.'))))))),
      h('div', { class: 'note' }, 'Pages are saved as single-file MHTML snapshots (PDFs as files) and open without internet. Use "Update" while online to refresh them; older versions are kept (see Settings). Pages that need a login or are built entirely by scripts may not save fully. Double-click a row to open it.'));
  }

  function viewer() {
    const it = store.get('webcache').find((x) => x.id === openId);
    if (!it) { view = 'list'; return list(); }
    const ver = (it.versions || []).find((v) => v.file === openVersion) || it.versions[0];
    const wv = h('webview', { partition: 'persist:viewer', plugins: true, webpreferences: 'javascript=yes' });
    const addr = h('input', { class: 'addr mono', readonly: true, value: it.url });
    const modePill = h('span', { class: 'pill ' + (live ? 'info' : 'ok') }, live ? 'LIVE' : 'CACHED ' + fmtDate(ver && ver.at, true));

    const loadCached = async () => {
      const url = await window.api.webcache.fileUrl(it.id, ver && ver.file);
      live = false;
      modePill.className = 'pill ok';
      modePill.textContent = 'CACHED ' + fmtDate(ver && ver.at, true);
      wv.src = url;
    };
    wv.addEventListener('did-navigate', (e) => { if (/^https?:/.test(e.url)) addr.value = e.url; });
    wv.addEventListener('did-fail-load', (e) => { if (e.errorCode !== -3) status('Load failed: ' + e.errorDescription); });
    if (live) wv.src = it.url; else loadCached();

    const others = store.get('webcache').filter((x) => x.file);
    return h('div', { style: 'display:flex;flex-direction:column;height:calc(100vh - 110px)' },
      h('div', { class: 'viewerbar' },
        h('button', { onclick: () => { view = 'list'; draw(); } }, icon('arrow-left'), 'Library'),
        h('button', { class: 'iconbtn', title: 'Back', onclick: () => wv.canGoBack() && wv.goBack() }, icon('arrow-left')),
        h('button', { class: 'iconbtn', title: 'Forward', onclick: () => wv.canGoForward() && wv.goForward() }, icon('arrow-right')),
        h('select', { style: 'max-width:280px', onchange: (e) => { openId = e.target.value; openVersion = null; live = false; draw(); } },
          others.map((o) => h('option', { value: o.id, selected: o.id === it.id }, `${o.group}: ${o.title}`))),
        modePill,
        addr,
        h('select', { title: 'Saved versions', onchange: (e) => { openVersion = e.target.value; live = false; draw(); } },
          (it.versions || []).map((v, i) => h('option', { value: v.file, selected: ver && v.file === ver.file }, (i === 0 ? 'Latest: ' : '') + fmtDate(v.at, true) + ' (' + fmtBytes(v.size) + ')'))),
        h('button', { onclick: () => { if (live) loadCached(); else { live = true; modePill.className = 'pill info'; modePill.textContent = 'LIVE'; wv.src = it.url; } } }, icon(live ? 'archive-outline' : 'web'), live ? 'Show cached' : 'View live'),
        h('button', { onclick: async () => { await capture([it.id]); openVersion = null; draw(); } }, icon('cloud-download-outline'), 'Update now'),
        h('button', { onclick: () => wv.print() }, icon('printer'), 'Print'),
        h('button', { onclick: () => window.api.app.openExternal(it.url) }, icon('open-in-new'), 'Open in browser')),
      wv);
  }

  draw();
  return () => offs.forEach((f) => f());
}
