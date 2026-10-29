import * as store from '../lib/store.js';
import { h, panel, status, fmtDate, fmtBytes, promptForm, confirmBox, daysUntil, icon, summary } from '../lib/ui.js';

const CATEGORIES = ['Identity', 'Insurance', 'Property', 'Financial', 'Medical', 'Vehicle', 'Legal', 'Family', 'Pets', 'Home inventory', 'Other'];

// Documents GOV.UK Be Ready and insurers suggest keeping copies of.
const SUGGESTED = [
  ['Passport', 'Identity'], ['Driving licence', 'Identity'], ['Birth certificate', 'Identity'], ['Marriage or civil partnership certificate', 'Family'],
  ['Home insurance policy', 'Insurance'], ['Car insurance', 'Insurance'], ['Life insurance', 'Insurance'], ['Travel or pet insurance', 'Insurance'],
  ['Mortgage or tenancy agreement', 'Property'], ['Property deeds', 'Property'], ['Bank and building society details', 'Financial'], ['Pension details', 'Financial'],
  ['Will and power of attorney', 'Legal'], ['Prescriptions and medication list', 'Medical'], ['NHS numbers and GP details', 'Medical'], ['Vaccination records', 'Medical'],
  ['Vehicle logbook (V5C)', 'Vehicle'], ['Pet microchip and vaccination records', 'Pets'], ['Recent photo of each person', 'Family'], ['Photos or video of home contents', 'Home inventory'],
];

const PREVIEW = { image: /^image\/(png|jpeg|gif|webp|bmp|svg\+xml)$/, pdf: /^application\/pdf$/, text: /^(text\/|application\/json)/ };

let openId = null;
let openFile = null;
let query = '';
let catFilter = '';

export async function render(root) {
  const offs = [];
  let st = await window.api.vault.status();
  let items = [];

  offs.push(window.api.on('vault:changed', async (s) => {
    const wasUnlocked = st.unlocked;
    st = s;
    if (wasUnlocked && !s.unlocked) status('Vault locked');
    if (wasUnlocked !== s.unlocked) draw();
  }));

  async function draw() {
    if (!st.exists) return root.replaceChildren(setup());
    if (!st.unlocked) return root.replaceChildren(unlock());
    items = await window.api.vault.list();
    if (openId && !items.find((i) => i.id === openId)) openId = null;
    root.replaceChildren(openId ? docView() : listView());
  }

  // ---- First run --------------------------------------------------------------------------
  function setup() {
    const pw = h('input', { type: 'password', autocomplete: 'new-password', oninput: () => meter() });
    const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const strength = h('span', { class: 'muted small' });
    const meter = () => {
      const v = pw.value;
      const score = (v.length >= 8) + (v.length >= 12) + (v.length >= 16) + (/[a-z]/.test(v) && /[A-Z]/.test(v)) + /\d/.test(v) + /[^A-Za-z0-9]/.test(v);
      const [label, col] = v.length < 8 ? ['Too short', 'var(--red)'] : score < 4 ? ['Weak', 'var(--amber)'] : score < 5 ? ['OK', 'var(--text)'] : ['Strong', 'var(--green)'];
      strength.textContent = v ? label : '';
      strength.style.color = col;
    };
    const go = async () => {
      if (pw.value.length < 8) return status('Use at least 8 characters');
      if (pw.value !== pw2.value) return status('Passwords do not match');
      try {
        const r = await window.api.vault.create(pw.value);
        await showRecoveryCode(r.recoveryCode, true);
        st = await window.api.vault.status();
        draw();
      } catch (e) { status(e.message, 8000); }
    };
    pw2.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    return h('div', { class: 'grid g2' },
      panel('Create the document vault', h('div', { class: 'stack' },
        h('div', { class: 'form' },
          h('label', null, 'Vault password'), h('div', { class: 'row' }, pw, strength),
          h('label', null, 'Repeat password'), pw2,
          h('label', null, ''), h('div', null, h('button', { class: 'primary', onclick: go }, icon('lock-outline'), 'Create vault'))),
        h('div', { class: 'note' }, 'Three or four unrelated words are easy to remember and hard to guess.'))),
      panel('How it works', h('ul', { class: 'small', style: 'margin:0;padding-left:18px;line-height:1.6' },
        h('li', null, 'Store scans and photos of passports, insurance policies, deeds, prescriptions and similar so you can get to them after a fire, flood or theft.'),
        h('li', null, 'Everything in the vault, including document names and notes, is encrypted on this computer with AES-256. Nothing is uploaded.'),
        h('li', null, 'You get a recovery code when you create the vault. Print it or write it down and keep it with your paper plan. Without the password or the recovery code the documents cannot be opened by anyone, including you.'),
        h('li', null, 'The vault locks itself when Windows locks or sleeps, when you close the app, and after a few minutes of inactivity.'),
        h('li', null, 'Files you add are copied in. The originals on your computer are not changed or deleted.'))));
  }

  function showRecoveryCode(code, first) {
    return new Promise((resolve) => {
      const cont = h('button', { class: 'primary', disabled: true, onclick: () => { dlg.close(); resolve(); } }, 'Continue');
      const dlg = h('dialog', null,
        h('div', { class: 'dh' }, 'Recovery code'),
        h('div', { class: 'db stack', style: 'max-width:480px' },
          h('div', null, first ? 'Your vault is created. ' : '', 'This code unlocks the vault if you forget the password. It is shown once. Print it or write it down and keep it with your paper emergency plan, not on this computer.'),
          h('div', { class: 'mono', style: 'font-size:22px;font-weight:600;text-align:center;padding:10px;border:1px solid var(--line);background:var(--panel2);user-select:all' }, code),
          h('div', { class: 'row' },
            h('button', { onclick: () => { navigator.clipboard.writeText(code); status('Copied'); } }, 'Copy'),
            h('button', { onclick: () => window.api.print.html(`<!doctype html><meta charset="utf-8"><body style="font-family:Segoe UI,sans-serif;padding:20mm"><h2>Holdfast Emergency Planning System: document vault recovery code</h2><p>Created ${new Date().toLocaleDateString('en-GB')}. Use this if the vault password is forgotten.</p><p style="font:600 26px Consolas,monospace;border:1px solid #000;padding:12px;text-align:center">${code}</p><p>Keep this with your paper emergency plan. Anyone with this code and access to the computer can open the vault.</p></body>`) }, 'Print')),
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', onchange: (e) => (cont.disabled = !e.target.checked) }), 'I have printed or written down the recovery code')),
        h('div', { class: 'df' }, cont));
      dlg.addEventListener('cancel', (e) => e.preventDefault());
      dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  // ---- Locked -----------------------------------------------------------------------------
  function unlock() {
    let recovery = false;
    const inp = h('input', { type: 'password', autocomplete: 'current-password', style: 'width:260px' });
    const lbl = h('label', null, 'Password');
    const msg = h('div', { class: 'small', style: 'color:var(--red);min-height:16px' });
    const btn = h('button', { class: 'primary' }, icon('lock-open-variant-outline'), 'Unlock');
    const toggle = h('a', { href: '#', class: 'small', onclick: (e) => {
      e.preventDefault();
      recovery = !recovery;
      lbl.textContent = recovery ? 'Recovery code' : 'Password';
      inp.type = recovery ? 'text' : 'password';
      inp.placeholder = recovery ? 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX' : '';
      inp.classList.toggle('mono', recovery);
      toggle.textContent = recovery ? 'Use password instead' : 'Forgotten the password? Use the recovery code';
      inp.value = '';
      inp.focus();
    } }, 'Forgotten the password? Use the recovery code');
    const go = async () => {
      if (!inp.value) return;
      btn.disabled = true;
      msg.textContent = 'Unlocking...';
      msg.style.color = 'var(--muted)';
      try {
        await window.api.vault.unlock(inp.value, recovery);
        st = await window.api.vault.status();
        if (recovery) {
          const v = await promptForm('Set a new vault password', [{ key: 'pw', label: 'New password', type: 'password' }, { key: 'pw2', label: 'Repeat', type: 'password' }], 'Save');
          if (v && v.pw && v.pw === v.pw2) {
            try { await window.api.vault.changePassword(v.pw, false); status('Password changed'); } catch (e) { status(e.message, 8000); }
          } else status('Password not changed. You can change it from the vault page.', 8000);
        }
        draw();
      } catch (e) {
        msg.style.color = 'var(--red)';
        msg.textContent = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
        btn.disabled = false;
        inp.select();
      }
    };
    btn.onclick = go;
    inp.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    setTimeout(() => inp.focus(), 0);
    return h('div', { style: 'max-width:560px' },
      panel('Document vault is locked', h('div', { class: 'stack' },
        h('div', { class: 'form' }, lbl, h('div', { class: 'row' }, inp, btn), h('label', null, ''), msg, h('label', null, ''), toggle),
        h('div', { class: 'note' }, 'Locks automatically after ', String(store.settings().vaultAutoLock || 'no'), ' minutes idle, when Windows locks or sleeps, and when the app closes.'))));
  }

  // ---- Unlocked: list ---------------------------------------------------------------------
  async function newDoc(defaults = {}) {
    const it = await window.api.vault.saveEntry({ name: 'New document', category: 'Other', ...defaults });
    openId = it.id;
    openFile = null;
    return it;
  }

  async function addDropped(fileList, entryId) {
    const files = [];
    for (const f of fileList) files.push({ name: f.name, type: f.type, data: new Uint8Array(await f.arrayBuffer()) });
    if (!files.length) return [];
    status(`Encrypting ${files.length} file(s)...`, 0);
    try {
      const added = await window.api.vault.addFiles(entryId, files);
      status(`Added ${added.length} file(s)`);
      return added;
    } catch (e) { status('Could not add: ' + e.message, 8000); return []; }
  }

  function dropZone(el, onFiles) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('dropping'); });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('dropping'); });
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('dropping'); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
    return el;
  }

  function people() {
    return ['', 'Household', ...store.get('household').people.map((p) => p.name).filter(Boolean)];
  }

  function expiryCell(it) {
    const d = daysUntil(it.expires);
    if (d == null) return '';
    if (d < 0) return h('span', { class: 'pill bad' }, 'expired');
    if (d <= 90) return h('span', { class: 'pill warn' }, d + ' d');
    return h('span', { class: 'muted' }, d + ' d');
  }

  function listView() {
    const q = query.toLowerCase();
    const shown = items.filter((i) => (!catFilter || i.category === catFilter) && (!q || [i.name, i.category, i.person, i.reference, i.issuer, i.notes, i.original, ...i.files.map((f) => f.name)].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));
    const nFiles = items.reduce((a, i) => a + i.files.length, 0);
    const bytes = items.reduce((a, i) => a + i.files.reduce((b, f) => b + f.size, 0), 0);
    const expired = items.filter((i) => (daysUntil(i.expires) ?? 1) < 0).length;
    const soon = items.filter((i) => { const d = daysUntil(i.expires); return d != null && d >= 0 && d <= 90; }).length;
    const noFile = items.filter((i) => !i.files.length).length;
    const have = new Set(items.map((i) => i.name.toLowerCase()));

    const open = (it) => { openId = it.id; openFile = null; draw(); };
    const rows = shown.map((it) => h('tr', { style: 'cursor:pointer', class: (daysUntil(it.expires) ?? 1) < 0 ? 'bad' : '', onclick: () => open(it) },
      h('td', { style: 'min-width:180px' }, icon(it.files.some((f) => PREVIEW.pdf.test(f.type)) ? 'file-pdf-box' : it.files.some((f) => PREVIEW.image.test(f.type)) ? 'file-image-outline' : 'file-document-outline', 'muted'), ' ', h('a', { href: '#', onclick: (e) => e.preventDefault() }, it.name)),
      h('td', null, it.category),
      h('td', null, it.person),
      h('td', { class: 'mono small' }, it.reference),
      h('td', { class: 'nowrap' }, fmtDate(it.expires)),
      h('td', { class: 'num' }, expiryCell(it)),
      h('td', { class: 'num' }, it.files.length || h('span', { class: 'pill warn' }, 'none')),
      h('td', { class: 'num' }, it.files.length ? fmtBytes(it.files.reduce((a, f) => a + f.size, 0)) : ''),
      h('td', null, it.original),
      h('td', { class: 'nowrap muted' }, fmtDate(it.updated))));

    const table = dropZone(h('div', { class: 'tblwrap dropzone' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Document', 'Category', 'Person', 'Reference / number', 'Expires', 'Left', 'Files', 'Size', 'Original kept at', 'Updated'].map((l, i) => h('th', { class: [5, 6, 7].includes(i) ? 'num' : '' }, l)))),
      h('tbody', null, rows.length ? rows : h('tr', { class: 'empty' }, h('td', { colspan: 10 }, items.length ? 'No matching documents' : 'The vault is empty. Click "Add document", pick one from the list on the right, or drop files here.'))))),
    async (files) => {
      // Each dropped file becomes its own document, named after the file.
      for (const f of files) {
        const it = await window.api.vault.saveEntry({ name: f.name.replace(/\.[^.]+$/, ''), category: 'Other' });
        await addDropped([f], it.id);
      }
      if (files.length === 1) openId = (await window.api.vault.list()).slice(-1)[0].id;
      draw();
    });

    return h('div', { class: 'stack' },
      h('div', { class: 'grid g21' },
        panel('Documents', h('div', null,
          h('div', { class: 'tbltools' },
            h('button', { class: 'primary', onclick: async () => { await newDoc(); draw(); } }, icon('plus'), 'Add document'),
            h('input', { type: 'search', placeholder: 'Filter...', value: query, oninput: (e) => { query = e.target.value; clearTimeout(listView.t); listView.t = setTimeout(draw, 250); } }),
            h('select', { onchange: (e) => { catFilter = e.target.value; draw(); } }, h('option', { value: '' }, 'All categories'), CATEGORIES.map((c) => h('option', { selected: c === catFilter }, c))),
            h('span', { class: 'spacer' }),
            summary(shown.length === items.length ? `${items.length} documents` : `${shown.length} of ${items.length} documents`, `${nFiles} files`, fmtBytes(bytes), expired && [`${expired} expired`, 'bad'], soon && [`${soon} expire within 90 days`, 'warn'], noFile && [`${noFile} with no file`, 'warn'])),
          table),
          h('button', { class: 'primary', onclick: () => window.api.vault.lock() }, icon('lock-outline'), 'Lock now')),
        h('div', { class: 'stack' },
          panel('Suggested documents', h('div', { class: 'list', style: 'max-height:360px' },
            SUGGESTED.map(([name, cat]) => {
              const done = have.has(name.toLowerCase());
              return h('div', { class: 'li', title: done ? 'Already in the vault' : 'Click to add', onclick: async () => {
                const it = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
                if (it) openId = it.id; else await newDoc({ name, category: cat });
                draw();
              } }, icon(done ? 'check-circle' : 'checkbox-blank-circle-outline', done ? 'ok' : 'muted'), h('span', null, name), h('span', { class: 'sub', style: 'margin-left:auto' }, cat));
            }))),
          securityPanel())));
  }

  function securityPanel() {
    const s = store.settings();
    return panel('Vault security', h('div', { class: 'stack' },
      h('div', { class: 'form' },
        h('label', null, 'Lock after idle'),
        h('select', { onchange: (e) => { s.vaultAutoLock = Number(e.target.value); store.save('settings'); } },
          [[1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [0, 'Never (still locks on Windows lock, sleep and exit)']].map(([v, l]) => h('option', { value: v, selected: Number(s.vaultAutoLock ?? 5) === v }, l))),
        h('label', null, 'Created'), h('span', null, fmtDate(st.created, true)),
        h('label', null, 'Password changed'), h('span', null, st.passwordChanged ? fmtDate(st.passwordChanged, true) : 'Never')),
      h('div', { class: 'row' },
        h('button', { onclick: async () => {
          const v = await promptForm('Change vault password', [{ key: 'pw', label: 'New password', type: 'password' }, { key: 'pw2', label: 'Repeat', type: 'password' }], 'Change');
          if (!v) return;
          if (v.pw !== v.pw2) return status('Passwords do not match');
          try { await window.api.vault.changePassword(v.pw, false); st = await window.api.vault.status(); status('Password changed'); draw(); } catch (e) { status(e.message.replace(/^.*Error: /, ''), 8000); }
        } }, 'Change password'),
        h('button', { onclick: async () => {
          if (!(await confirmBox('Make a new recovery code? The old code will stop working.', 'New code'))) return;
          const r = await window.api.vault.changePassword(null, true);
          await showRecoveryCode(r.recoveryCode, false);
        } }, 'New recovery code')),
      h('div', { class: 'row' },
        h('button', { onclick: async () => { const r = await window.api.vault.backup(); if (r.ok) status('Encrypted backup saved to ' + r.path, 10000); } }, 'Back up vault...'),
        h('button', { onclick: async () => {
          if (!(await confirmBox('Restore replaces this vault with the backup. The current vault is kept in the data folder as "vault-replaced-...". Continue?', 'Choose folder'))) return;
          try { const r = await window.api.vault.restore(); if (r.ok) { st = await window.api.vault.status(); status('Vault restored. Unlock it with the password it was backed up with.', 10000); draw(); } } catch (e) { status(e.message.replace(/^.*Error: /, ''), 8000); }
        } }, 'Restore...'),
        h('button', { class: 'danger', onclick: async () => {
          const v = await promptForm('Delete the vault', [{ key: 'c', label: 'Type DELETE to permanently delete every document in the vault' }], 'Delete');
          if (!v || v.c !== 'DELETE') return;
          await window.api.vault.destroy();
          st = await window.api.vault.status();
          draw();
        } }, 'Delete vault')),
      h('div', { class: 'note' }, 'Backups stay encrypted and open with the same password or recovery code. Copy one to a USB stick for your grab bag.')));
  }

  // ---- Unlocked: one document --------------------------------------------------------------
  function docView() {
    const it = items.find((i) => i.id === openId);
    if (!openFile || !it.files.find((f) => f.id === openFile)) openFile = it.files[0] ? it.files[0].id : null;
    let t;
    const save = (k, v) => { it[k] = v; clearTimeout(t); t = setTimeout(() => window.api.vault.saveEntry({ id: it.id, [k]: v }).then(() => (document.getElementById('savestate').textContent = 'Saved')), 400); };
    const fld = (k, label, type = 'text') => [h('label', null, label), h('input', { type, value: it[k] || '', oninput: (e) => save(k, e.target.value) })];
    const sel = (k, label, opts) => [h('label', null, label), h('select', { onchange: (e) => save(k, e.target.value) }, [...new Set([...opts, it[k] || ''])].map((o) => h('option', { value: o, selected: o === (it[k] || '') }, o || '-')))];

    const fileRows = it.files.map((f) => h('tr', { class: f.id === openFile ? 'selected' : '', style: 'cursor:pointer', onclick: () => { openFile = f.id; draw(); } },
      h('td', null, f.name),
      h('td', { class: 'num nowrap' }, fmtBytes(f.size)),
      h('td', { class: 'act' },
        h('button', { title: 'Save a decrypted copy...', onclick: async (e) => { e.stopPropagation(); const r = await window.api.vault.saveCopy(f.id); if (r.ok) status('Saved to ' + r.path, 8000); } }, icon('download')),
        h('button', { title: 'Open in the default program (temporary copy, deleted when the vault locks)', onclick: (e) => { e.stopPropagation(); window.api.vault.openExternal(f.id).catch((er) => status(er.message, 8000)); } }, icon('open-in-new')),
        h('button', { class: 'del', title: 'Remove from vault', onclick: async (e) => {
          e.stopPropagation();
          if (!(await confirmBox(`Remove "${f.name}" from the vault?`, 'Remove', true))) return;
          await window.api.vault.removeFile(it.id, f.id);
          draw();
        } }, icon('close')))));

    const side = h('div', { class: 'side', style: 'width:360px;overflow:auto' },
      panel('Details', h('div', { class: 'form', style: 'grid-template-columns:110px 1fr' },
        ...fld('name', 'Name'),
        ...sel('category', 'Category', CATEGORIES),
        ...sel('person', 'Person', people()),
        ...fld('reference', 'Number / ref'),
        ...fld('issuer', 'Issued by'),
        ...fld('issued', 'Issued', 'date'),
        ...fld('expires', 'Expires', 'date'),
        ...fld('original', 'Original kept at'),
        h('label', null, 'Notes'), h('textarea', { rows: 4, oninput: (e) => save('notes', e.target.value) }, it.notes || ''))),
      dropZone(panel('Files', h('div', null,
        h('div', { class: 'tbltools' },
          h('button', { onclick: async () => { const a = await window.api.vault.pickFiles(it.id); if (a.length) { openFile = a[0].id; draw(); } } }, 'Add files...'),
          h('span', { class: 'muted small' }, 'or drop files here')),
        h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' }, h('tbody', null, fileRows.length ? fileRows : h('tr', { class: 'empty' }, h('td', null, 'No files yet. Scan or photograph the document and add it here.'))))))),
      async (files) => { const a = await addDropped(files, it.id); if (a.length) openFile = a[0].id; draw(); }));

    return h('div', { style: 'display:flex;flex-direction:column;height:calc(100vh - 110px)' },
      h('div', { class: 'viewerbar' },
        h('button', { onclick: () => { openId = null; draw(); } }, icon('arrow-left'), 'All documents'),
        h('b', null, it.name),
        h('span', { class: 'muted' }, it.category),
        expiryCell(it),
        h('span', { class: 'spacer' }),
        h('button', { class: 'danger', onclick: async () => {
          if (!(await confirmBox(`Delete "${it.name}" and its ${it.files.length} file(s) from the vault?`, 'Delete', true))) return;
          await window.api.vault.removeEntry(it.id);
          openId = null;
          draw();
        } }, 'Delete document'),
        h('button', { class: 'primary', onclick: () => window.api.vault.lock() }, icon('lock-outline'), 'Lock now')),
      h('div', { class: 'split' }, side, h('div', { class: 'body' }, preview(it.files.find((f) => f.id === openFile)))));
  }

  function preview(f) {
    const box = h('div', { class: 'vaultpreview' });
    if (!f) {
      box.append(h('div', { class: 'muted' }, 'No file selected.'));
      return box;
    }
    const src = 'vault://file/' + f.id + '/' + encodeURIComponent(f.name);
    if (PREVIEW.image.test(f.type)) {
      const img = h('img', { src, alt: f.name, title: 'Click to toggle actual size', onclick: () => img.classList.toggle('actual') });
      box.append(img);
    } else if (PREVIEW.pdf.test(f.type)) {
      box.append(h('iframe', { src }));
    } else if (PREVIEW.text.test(f.type)) {
      const pre = h('pre', null, 'Loading...');
      fetch(src).then((r) => r.text()).then((t) => (pre.textContent = t)).catch((e) => (pre.textContent = e.message));
      box.append(pre);
    } else {
      box.append(h('div', { class: 'stack', style: 'padding:20px' },
        h('div', null, `${f.name} (${f.type}, ${fmtBytes(f.size)}) cannot be previewed here.`),
        h('div', { class: 'row' },
          h('button', { onclick: () => window.api.vault.openExternal(f.id).catch((e) => status(e.message, 8000)) }, 'Open in default program'),
          h('button', { onclick: async () => { const r = await window.api.vault.saveCopy(f.id); if (r.ok) status('Saved to ' + r.path, 8000); } }, 'Save decrypted copy...')),
        h('div', { class: 'note' }, 'Opening in another program writes a temporary decrypted copy. It is deleted when the vault locks.')));
    }
    return box;
  }

  await draw();
  return () => offs.forEach((f) => f());
}
