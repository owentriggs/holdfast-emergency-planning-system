// Small DOM helpers and the editable table used across the app.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'string') el.style.cssText = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

// Material Design Icons (@mdi/font). name is the icon name without the "mdi-" prefix.
export function icon(name, cls) {
  return h('i', { class: `mdi mdi-${name}${cls ? ' ' + cls : ''}`, 'aria-hidden': 'true' });
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function panel(title, body, tools) {
  return h('div', { class: 'panel' },
    h('div', { class: 'ph' }, h('h3', null, title), h('span', { class: 'spacer' }), tools),
    h('div', { class: 'pb' + (body && body.classList && body.classList.contains('tblwrap') ? ' flush' : '') }, body));
}

export function tabs(items, active, onSelect) {
  return h('div', { class: 'tabs' },
    items.map((t) => h('div', { class: 'tab' + (t.id === active ? ' active' : ''), onclick: () => onSelect(t.id) },
      t.label, t.count != null ? h('span', { class: 'count' }, t.count) : null)));
}

export function stat(label, value, cls) {
  return h('div', { class: 'stat ' + (cls || '') }, h('div', { class: 'v' }, value), h('div', { class: 'l' }, label));
}

// One-line count summary for a panel header. parts: text, or [text, 'warn' | 'bad'] to flag a problem; empty parts are skipped.
export function summary(...parts) {
  return h('span', { class: 'summary' }, parts.filter(Boolean).map((p) => (Array.isArray(p) ? h('span', { class: p[1] || '' }, p[0]) : h('span', null, p))));
}

export function bar(frac, cls) {
  const pct = Math.max(0, Math.min(1, frac || 0)) * 100;
  return h('div', { class: 'bar ' + (cls || '') }, h('i', { style: `width:${pct}%` }));
}

export function status(msg, ms = 4000) {
  const el = document.getElementById('statusmsg');
  el.textContent = msg;
  clearTimeout(status.t);
  if (ms) status.t = setTimeout(() => (el.textContent = ''), ms);
}

export function fmtDate(iso, withTime) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const ds = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return withTime ? ds + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ds;
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + u[i];
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

export function ageFrom(dob) {
  if (!dob) return '';
  const d = new Date(dob);
  if (isNaN(d)) return '';
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
}

// Modal dialog. fields: [{key,label,type,options,value}] Returns values or null.
export function promptForm(title, fields, okLabel = 'OK') {
  return new Promise((resolve) => {
    const inputs = {};
    const body = h('div', { class: 'form' },
      fields.map((f) => {
        let inp;
        if (f.type === 'select') inp = h('select', null, f.options.map((o) => h('option', { value: o.value ?? o, selected: (o.value ?? o) === f.value }, o.label ?? o)));
        else if (f.type === 'textarea') inp = h('textarea', { rows: 4 }, f.value || '');
        else inp = h('input', { type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '' });
        inputs[f.key] = inp;
        return [h('label', null, f.label), inp];
      }));
    const dlg = h('dialog', null,
      h('div', { class: 'dh' }, title),
      h('div', { class: 'db' }, body),
      h('div', { class: 'df' },
        h('button', { onclick: () => { dlg.close(); resolve(null); } }, 'Cancel'),
        h('button', { class: 'primary', onclick: () => {
          const out = {};
          for (const [k, i] of Object.entries(inputs)) out[k] = i.type === 'checkbox' ? i.checked : i.value;
          dlg.close();
          resolve(out);
        } }, okLabel)));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg.close(); resolve(null); });
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') dlg.querySelector('button.primary').click(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    const first = Object.values(inputs)[0];
    if (first) first.focus();
  });
}

// In-page confirmation. Native window.confirm() is avoided because on Windows it can leave
// text fields unable to take keyboard input after it closes (Electron focus bug).
export function confirmBox(msg, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    const done = (v) => { dlg.close(); resolve(v); };
    const ok = h('button', { class: danger ? 'primary danger-fill' : 'primary', onclick: () => done(true) }, okLabel);
    const dlg = h('dialog', null,
      h('div', { class: 'db', style: 'max-width:460px' }, msg),
      h('div', { class: 'df' }, h('button', { onclick: () => done(false) }, 'Cancel'), ok));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
    document.body.appendChild(dlg);
    dlg.showModal();
    ok.focus();
  });
}

// In-page message with a single OK button. iconName is an MDI icon shown beside the title.
export function messageBox(title, msg, iconName) {
  return new Promise((resolve) => {
    const ok = h('button', { class: 'primary', onclick: () => dlg.close() }, 'OK');
    const dlg = h('dialog', null,
      h('div', { class: 'dh' }, iconName ? [icon(iconName), ' '] : null, title),
      h('div', { class: 'db', style: 'max-width:460px' }, msg),
      h('div', { class: 'df' }, ok));
    dlg.addEventListener('close', () => { setTimeout(() => dlg.remove(), 0); resolve(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    ok.focus();
  });
}

/*
 Editable table.
 columns: [{ key, label, type: text|number|date|select|textarea|checkbox|ro, options, width, compute(row), cls(row) }]
 rows: array mutated in place. onChange(rows) is called after every edit.
 opts: { newRow(), addLabel, search: true, rowClass(row), actions(row) => [nodes], sortable: true, reorder: true, toolbar: [nodes], emptyText,
         suggestions: { rows: [...], key, label } (optional starter rows the user can add; matched on key, default first column) }
*/
export function editTable(columns, rows, onChange, opts = {}) {
  const wrap = h('div', { class: 'edtable' });
  let sortKey = null, sortDir = 1, query = '';
  const tbody = h('tbody');
  const countEl = h('span', { class: 'muted small' });

  const thead = h('thead', null, h('tr', null,
    columns.map((c) => {
      const th = h('th', { class: (c.type === 'number' || c.num ? 'num ' : '') + (opts.sortable !== false ? 'sortable' : ''), style: c.width ? `width:${c.width}` : null, title: c.title || null }, c.label);
      // Click cycles: ascending, descending, original order.
      if (opts.sortable !== false) th.onclick = () => {
        if (sortKey === c.key && sortDir === -1) sortKey = null;
        else {
          sortDir = sortKey === c.key ? -1 : 1;
          sortKey = c.key;
        }
        draw();
      };
      return th;
    }),
    h('th', { style: 'width:1%' }, '')));

  const table = h('table', { class: 'tbl edit' }, thead, tbody);

  function changed(row, tr) {
    onChange(rows);
    if (tr) refreshComputed(row, tr);
  }

  function refreshComputed(row, tr) {
    columns.forEach((c, i) => {
      if (c.type === 'ro' && c.compute) {
        const td = tr.children[i];
        td.replaceChildren(fmtCell(c.compute(row)));
      }
    });
    tr.className = opts.rowClass ? opts.rowClass(row) || '' : '';
  }

  function fmtCell(v) {
    return v instanceof Node ? v : document.createTextNode(v ?? '');
  }

  function cell(c, row, tr) {
    const val = row[c.key];
    const set = (v) => { row[c.key] = v; changed(row, tr); };
    switch (c.type) {
      case 'ro':
        return h('td', { class: 'ro' + (c.num ? ' num' : '') }, fmtCell(c.compute ? c.compute(row) : val));
      case 'checkbox':
        return h('td', { style: 'text-align:center;padding:3px' }, h('input', { type: 'checkbox', checked: !!val, onchange: (e) => set(e.target.checked) }));
      case 'select':
        return h('td', null, h('select', { onchange: (e) => set(e.target.value) },
          (typeof c.options === 'function' ? c.options(row) : c.options).map((o) => h('option', { value: o.value ?? o, selected: (o.value ?? o) === (val ?? '') }, o.label ?? o))));
      case 'textarea':
        return h('td', null, h('textarea', { rows: 1, oninput: (e) => set(e.target.value), placeholder: c.placeholder || '' }, val ?? ''));
      case 'number':
        return h('td', { class: 'num' }, h('input', { type: 'number', step: c.step || 'any', value: val ?? '', style: 'text-align:right', oninput: (e) => set(e.target.value === '' ? null : Number(e.target.value)) }));
      case 'date':
        return h('td', null, h('input', { type: 'date', value: val ?? '', oninput: (e) => set(e.target.value) }));
      default:
        return h('td', null, h('input', { type: 'text', value: val ?? '', placeholder: c.placeholder || '', list: c.list || null, oninput: (e) => set(e.target.value) }));
    }
  }

  function draw() {
    let view = rows.map((r, i) => ({ r, i }));
    if (query) {
      const q = query.toLowerCase();
      view = view.filter(({ r }) => columns.some((c) => String(c.compute ? c.compute(r) : r[c.key] ?? '').toLowerCase().includes(q)));
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      const val = (r) => (col.compute ? col.compute(r) : r[sortKey]);
      view.sort((a, b) => {
        const x = val(a.r), y = val(b.r);
        if (x == null || x === '') return 1;
        if (y == null || y === '') return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en-GB', { numeric: true })) * sortDir;
      });
    }
    tbody.replaceChildren();
    if (!view.length) tbody.appendChild(h('tr', { class: 'empty' }, h('td', { colspan: columns.length + 1 },
      query ? 'No matching rows' : [opts.emptyText || 'Nothing added yet.', ' ', missingSuggestions().length ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); addSuggestions(); } }, `Add the ${missingSuggestions().length} suggested items`) : null, missingSuggestions().length ? ' or use "Add" above.' : ''])));
    for (const { r, i } of view) {
      const tr = h('tr', { class: opts.rowClass ? opts.rowClass(r) || '' : '' });
      columns.forEach((c) => tr.appendChild(cell(c, r, tr)));
      const act = h('td', { class: 'act' },
        opts.actions ? opts.actions(r) : null,
        opts.reorder !== false && !sortKey && !query ? [
          h('button', { title: 'Move up', onclick: () => move(i, -1) }, icon('chevron-up')),
          h('button', { title: 'Move down', onclick: () => move(i, 1) }, icon('chevron-down')),
        ] : null,
        h('button', { class: 'del', title: 'Delete row', onclick: async () => {
          const label = r[columns[0].key];
          if (label && !(await confirmBox(`Delete "${label}"?`, 'Delete', true))) return;
          rows.splice(rows.indexOf(r), 1);
          onChange(rows);
          draw();
        } }, icon('close')));
      tr.appendChild(act);
      tbody.appendChild(tr);
    }
    countEl.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;
    if (sugBtn) {
      const n = missingSuggestions().length;
      sugBtn.style.display = n ? '' : 'none';
      sugBtn.lastChild.textContent = `Add suggestions (${n})`;
    }
  }

  const keyCol = (opts.suggestions && opts.suggestions.key) || columns[0].key;
  function missingSuggestions() {
    if (!opts.suggestions) return [];
    const have = new Set(rows.map((r) => String(r[keyCol] ?? '').trim().toLowerCase()));
    return opts.suggestions.rows.filter((s) => !have.has(String(s[keyCol]).trim().toLowerCase()));
  }
  function addSuggestions() {
    for (const s of missingSuggestions()) rows.push({ ...structuredClone(s), id: uid() });
    onChange(rows);
    draw();
  }
  const sugBtn = opts.suggestions ? h('button', { title: opts.suggestions.label || 'Add common items you can then fill in or delete', onclick: addSuggestions }, 'Add suggestions') : null;

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    onChange(rows);
    draw();
  }

  const tools = h('div', { class: 'tbltools' },
    h('button', { onclick: () => {
      const r = { id: uid(), ...(opts.newRow ? opts.newRow() : {}) };
      rows.push(r);
      sortKey = null;
      query = '';
      if (search) search.value = '';
      onChange(rows);
      draw();
      const last = tbody.lastElementChild && tbody.lastElementChild.querySelector('input,select,textarea');
      if (last) last.focus();
    } }, opts.addLabel || 'Add row'),
    sugBtn,
    opts.toolbar || null,
    h('span', { class: 'spacer' }),
    countEl);
  let search = null;
  if (opts.search !== false) {
    search = h('input', { type: 'search', placeholder: 'Filter...', oninput: (e) => { query = e.target.value; draw(); } });
    tools.insertBefore(search, tools.children[1]);
  }

  wrap.append(tools, h('div', { class: 'tblwrap' }, table));
  draw();
  wrap.redraw = draw;
  return wrap;
}

// Read-only table from data. columns: [{label, get(row) or key, num, width}]
export function table(columns, rows, opts = {}) {
  return h('div', { class: 'tblwrap', style: opts.maxHeight ? `max-height:${opts.maxHeight}` : null },
    h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, columns.map((c) => h('th', { class: c.num ? 'num' : '', style: c.width ? `width:${c.width}` : null }, c.label)))),
      h('tbody', null,
        rows.length ? rows.map((r) => h('tr', { class: opts.rowClass ? opts.rowClass(r) || '' : '', onclick: opts.onRowClick ? () => opts.onRowClick(r) : null, style: opts.onRowClick ? 'cursor:pointer' : null },
          columns.map((c) => {
            const v = c.get ? c.get(r) : r[c.key];
            return h('td', { class: c.num ? 'num' : '' }, v instanceof Node ? v : v ?? '');
          })))
          : h('tr', { class: 'empty' }, h('td', { colspan: columns.length }, opts.emptyText || 'Nothing to show')))));
}

// Chart.js wrapper that picks up theme colours.
export function chart(canvasParent, config) {
  const cs = getComputedStyle(document.documentElement);
  const text = cs.getPropertyValue('--muted').trim();
  const line = cs.getPropertyValue('--line2').trim();
  Chart.defaults.color = text;
  Chart.defaults.borderColor = line;
  Chart.defaults.font.family = 'Segoe UI, system-ui, sans-serif';
  Chart.defaults.font.size = 11;
  const canvas = h('canvas');
  canvasParent.replaceChildren(canvas);
  config.options = { responsive: true, maintainAspectRatio: false, animation: false, ...config.options };
  return new Chart(canvas, config);
}

// Chart colours from the theme, read when a chart is drawn so they follow light and dark.
// Red is for expired or dangerous values only; series is for charts that need several neutral colours.
export function chartColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return { accent: v('--accent'), amber: v('--amber'), red: v('--red'), green: v('--green'), muted: v('--muted'),
    series: [v('--accent'), v('--green'), v('--amber'), v('--muted')] };
}
