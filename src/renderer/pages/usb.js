import * as store from '../lib/store.js';
import { h, panel, status, fmtDate, fmtBytes, confirmBox, daysUntil, icon, stat, bar } from '../lib/ui.js';
import { SECTIONS, buildDocument } from '../lib/printdoc.js';

const opts = { plan: true, protect: false, pdf: true, vault: true, library: false, tiles: false, app: false };
let target = null; // { path, label }
let restoreFrom = null; // { path, manifest }

const errMsg = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const KIND = {
  usb: (c) => (c.pc === undefined ? ['Added on drive', 'info'] : c.usb === undefined ? ['Removed on drive', 'warn'] : ['Changed on drive', 'info']),
  conflict: () => ['Changed on both', 'bad'],
  'only-usb': () => ['Only on drive', 'info'],
  'only-pc': () => ['Only on this PC', ''],
};

function fmtVal(v) {
  if (v === undefined) return h('span', { class: 'muted' }, '(not there)');
  if (v === '' || v === null) return h('span', { class: 'muted' }, '(blank)');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return `${v.length} item(s)`;
  if (typeof v === 'object') {
    const parts = Object.entries(v).filter(([k, x]) => !/^(id|added|updated|sha256|carer[0-9])$/.test(k) && x !== '' && x != null && typeof x !== 'object').slice(0, 4).map(([k, x]) => `${k}: ${x}`);
    return h('span', { class: 'small' }, parts.join(', ') || 'row');
  }
  const s = String(v);
  return s.length > 90 ? s.slice(0, 90) + '...' : s;
}

export async function render(root, params = {}) {
  const offs = [];
  let est = await window.api.usb.estimate();
  let drives = [];
  let busy = false;
  let review = null; // { target, p, choices }
  let since = null; // { list, created, hasBase }: what this PC changed since its last backup to the selected drive
  if (!est.vaultExists) opts.vault = false;
  if (!est.appAvailable) opts.app = false;

  const progBar = h('div', { class: 'progress' }, h('i'));
  const progText = h('div', { class: 'muted small', style: 'min-height:16px' });
  offs.push(window.api.on('backup:progress', (p) => {
    progBar.firstChild.style.width = `${(p.done / Math.max(1, p.total)) * 100}%`;
    progText.textContent = p.phase === 'Finished' ? 'Finished' : `${p.phase}: ${p.done} of ${p.total}${p.file ? '  ' + p.file : ''}`;
  }));

  async function loadDrives() {
    try { drives = await window.api.usb.drives(); } catch (e) { drives = []; status('Could not list drives: ' + errMsg(e), 8000); }
    if (target && target.drive && !drives.find((d) => d.root === target.path)) target = null;
    if (!target) {
      const d = drives.find((x) => x.removable) || null;
      if (d) target = { path: d.root, label: `${d.id} ${d.label}`, drive: d };
    } else if (target.drive) target.drive = drives.find((d) => d.root === target.path);
  }

  // Watch for drives being plugged in or removed while the page is open.
  const timer = setInterval(async () => {
    if (busy) return;
    const before = drives.map((d) => d.id + d.free).join();
    await loadDrives();
    if (drives.map((d) => d.id + d.free).join() !== before) draw();
  }, 5000);
  offs.push(() => clearInterval(timer));

  const selectedSize = () => (opts.plan ? est.plan : 0) + (opts.vault ? est.vault : 0) + (opts.library ? est.library : 0) + (opts.tiles ? est.tiles : 0) + (opts.app ? est.app : 0) + (opts.pdf ? 300 * 1024 : 0);

  function draw() {
    root.replaceChildren(page());
  }

  // Compares the selected drive with this computer. Shows the review panel if the drive was changed elsewhere.
  async function loadReview(path, choices = {}) {
    try {
      store.flush();
      const p = await window.api.usb.preview(path, choices);
      review = p.usbChanges || p.vault.state === 'locked' || p.vault.state === 'different' ? { target: path, p, choices } : null;
      since = p.manifest ? { list: p.since || [], created: p.manifest.created, hasBase: !!p.since } : null;
    } catch (e) { review = null; since = null; }
  }

  function sincePanel() {
    const what = (c) => (c.was === undefined ? ['Added', 'ok'] : c.now === undefined ? ['Removed', 'warn'] : ['Changed', 'info']);
    const title = `Changes since the last backup${since.created ? ' on ' + fmtDate(since.created, true) : ''}`;
    if (!since.hasBase) return panel(title, h('div', { class: 'muted small' }, 'The last backup on this drive was made on another computer or by an older version, so the changes cannot be listed. Everything is copied when you back up.'));
    if (!since.list.length) return panel(title, h('div', { class: 'muted small' }, icon('check'), ' Nothing in the plan has changed. The drive is up to date.'));
    return panel(title, h('div', { class: 'stack' },
      h('div', { class: 'small' }, h('b', null, `${since.list.length} change(s)`), ' made on this PC will be copied to the drive.'),
      h('div', { class: 'tblwrap', style: 'max-height:260px' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Section', 'Item', '', 'Was', 'Now'].map((l) => h('th', null, l)))),
        h('tbody', null, since.list.map((c) => {
          const [txt, cls] = what(c);
          return h('tr', null,
            h('td', { class: 'nowrap' }, c.label[0]),
            h('td', null, c.label.slice(1).join(' > ')),
            h('td', null, h('span', { class: 'pill ' + cls }, txt)),
            h('td', { class: 'muted' }, fmtVal(c.was)),
            h('td', null, fmtVal(c.now)));
        }))))));
  }

  function reviewPanel() {
    const { p, choices } = review;
    const drive = review.target.replace(/\\$/, '');
    const listed = p.changes;
    const conflicts = listed.filter((c) => c.kind === 'conflict').length;
    const setAll = async (side) => { for (const c of listed) choices[c.id] = side; await loadReview(review.target, choices); draw(); };
    const rows = listed.map((c) => {
      const [txt, cls] = KIND[c.kind](c);
      const item = c.label.slice(1).join(' > ');
      return h('tr', { class: c.kind === 'conflict' ? 'warn' : '' },
        h('td', { class: 'nowrap' }, c.label[0]),
        h('td', null, item),
        h('td', null, h('span', { class: 'pill ' + cls }, txt)),
        h('td', { style: c.choice === 'pc' ? 'font-weight:600' : '' }, fmtVal(c.pc)),
        h('td', { style: c.choice === 'usb' ? 'font-weight:600' : '' }, fmtVal(c.usb)),
        h('td', null, h('select', { onchange: async (e) => { choices[c.id] = e.target.value; await loadReview(review.target, choices); draw(); } },
          h('option', { value: 'usb', selected: c.choice === 'usb' }, 'Use drive'),
          h('option', { value: 'pc', selected: c.choice === 'pc' }, 'Keep this PC'))));
    });
    return panel(`Changes on ${drive} made on another computer`, h('div', { class: 'stack' },
      h('div', null, `The copy of the program on this drive was used on another computer. `,
        h('b', null, `${p.usbChanges} change(s)`), ' found', conflicts ? [', ', h('b', { style: 'color:var(--red)' }, `${conflicts} changed on both`), ' (pick which to keep)'] : '', '. ',
        p.pcChanges ? `${p.pcChanges} change(s) made on this PC since the last backup will be copied to the drive. ` : '',
        'Changes from the drive are selected by default. Check the list, then apply.'),
      p.hasBase ? null : h('div', { class: 'note warn' }, 'This backup was made by an older version, so the app cannot tell which side made each change. Everything that differs is listed; choose what to keep.'),
      p.vault.state === 'locked' ? h('div', { class: 'note warn row' }, 'The document vault on the drive has changed. Unlock the vault to compare documents.', h('button', { onclick: () => window.go('vault') }, icon('lock-open-variant-outline'), 'Unlock vault')) : null,
      p.vault.state === 'different' ? h('div', { class: 'note warn' }, 'The document vault on the drive is a different vault (created separately), so it is not compared or changed.') : null,
      listed.length ? h('div', { class: 'tblwrap', style: 'max-height:360px' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Section', 'Item', 'What happened', 'This PC', 'Drive', 'Use'].map((l) => h('th', null, l)))),
        h('tbody', null, rows))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'primary', disabled: p.vault.state === 'locked', onclick: async () => {
          const take = listed.filter((c) => c.choice === 'usb').length;
          if (!(await confirmBox(`Bring ${take} change(s) from the drive into this PC, keep the rest as they are here, then update the drive so both match?`, 'Apply'))) return;
          busy = true;
          try {
            store.flush();
            const r = await window.api.usb.apply(review.target, choices);
            status(`Applied ${r.applied} change(s). This PC and the drive now match.`, 10000);
            store.reloadFromDisk();
          } catch (e) { status('Could not apply: ' + errMsg(e), 10000); }
          busy = false;
        } }, icon('sync'), 'Apply and update drive'),
        h('button', { onclick: () => setAll('usb') }, 'Use drive for all'),
        h('button', { onclick: () => setAll('pc') }, 'Keep this PC for all'),
        h('span', { class: 'spacer' }),
        h('button', { onclick: () => { review = null; draw(); } }, 'Not now'))));
  }

  function page() {
    const s = store.settings();
    const age = s.lastUsbBackup ? -daysUntil(s.lastUsbBackup.slice(0, 10)) : null;
    return h('div', { class: 'stack' },
      h('div', { class: 'intro' }, icon('information-outline'), 'Copy your plan, documents and offline data to a USB stick or external drive for your grab bag. Plug the drive in, check what to include, then click "Back up now". Repeat backups only copy what changed.'),
      h('div', { class: 'stats' },
        stat('Last backup', s.lastUsbBackup ? fmtDate(s.lastUsbBackup) : 'Never', age == null || age > 30 ? 'warn' : 'ok'),
        stat('Days since', age == null ? '-' : age, age == null || age > 30 ? 'warn' : 'ok'),
        stat('Plan data', fmtBytes(est.plan)),
        stat('Document vault', est.vaultExists ? fmtBytes(est.vault) : 'Not set up'),
        stat('Offline library', fmtBytes(est.library)),
        stat('Map tiles', fmtBytes(est.tiles))),
      review ? reviewPanel() : null,
      h('div', { class: 'grid g21' },
        h('div', { class: 'stack' }, drivePanel(), since && !review ? sincePanel() : null, includePanel()),
        h('div', { class: 'stack' }, restorePanel(), panel('Good practice', h('ul', { class: 'small', style: 'margin:0;padding-left:18px;line-height:1.6' },
          h('li', null, 'Back up after you change the plan, and at least monthly. The page warns after 30 days.'),
          h('li', null, 'Keep one drive in your grab bag and, if you can, one with a trusted person away from home.'),
          h('li', null, 'Turn on "Protect plan data with a password" if the drive could be lost. The printable PDF is never protected, so leave it out in that case.'),
          h('li', null, 'Use "Eject" before unplugging so nothing is lost.'))))));
  }

  function drivePanel() {
    const rows = drives.map((d) => {
      const used = d.size - d.free;
      const sel = target && target.path === d.root;
      return h('tr', { class: sel ? 'selected' : '', style: 'cursor:pointer', onclick: async () => { target = { path: d.root, label: `${d.id} ${d.label}`, drive: d }; if (d.manifest) await loadReview(d.root); else review = since = null; draw(); } },
        h('td', { style: 'width:24px;text-align:center' }, h('input', { type: 'radio', name: 'drv', checked: sel })),
        h('td', { class: 'nowrap' }, icon(d.removable ? 'usb-flash-drive-outline' : 'harddisk', 'muted'), ' ', h('b', null, d.id), ' ', d.label),
        h('td', null, d.type),
        h('td', null, d.fs),
        h('td', { style: 'min-width:140px' }, bar(used / d.size, used / d.size > 0.9 ? 'bad' : ''), h('span', { class: 'small muted' }, `${fmtBytes(d.free)} free of ${fmtBytes(d.size)}`)),
        h('td', null, d.manifest ? h('span', { class: 'pill ' + (d.manifest.complete ? 'ok' : 'warn') }, (d.manifest.complete ? 'Backup ' : 'Unfinished backup ') + fmtDate(d.manifest.created || d.manifest.started, true)) : h('span', { class: 'muted' }, 'none')),
        h('td', { class: 'act' }, d.removable ? h('button', { title: 'Eject so it is safe to unplug', onclick: async (e) => {
          e.stopPropagation();
          await window.ejectDrive(d.id);
          await loadDrives();
          draw();
        } }, icon('eject-outline')) : null));
    });
    const custom = target && !target.drive;
    return panel('1. Drive', h('div', null,
      h('div', { class: 'tbltools' },
        h('button', { onclick: async () => { await loadDrives(); draw(); } }, icon('refresh'), 'Refresh'),
        h('button', { onclick: async () => {
          const r = await window.api.usb.chooseFolder('Choose a folder to back up into');
          if (r) { target = { path: r.path, label: r.path, manifest: r.manifest }; if (r.manifest) await loadReview(r.path); else review = since = null; draw(); }
        } }, icon('folder-outline'), 'Choose a folder instead...'),
        custom ? h('span', { class: 'pill info' }, 'Folder: ' + target.path) : null,
        h('span', { class: 'spacer' }),
        h('span', { class: 'muted small' }, 'Updates when a drive is plugged in')),
      h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th'), h('th', null, 'Drive'), h('th', null, 'Type'), h('th', null, 'Format'), h('th', null, 'Space'), h('th', null, 'On this drive'), h('th'))),
        h('tbody', null, rows.length ? rows : h('tr', { class: 'empty' }, h('td', { colspan: 7 }, 'No USB or external drives found. Plug one in, or choose a folder instead.')))))));
  }

  function includePanel() {
    const pw = h('input', { type: 'password', placeholder: 'Backup password', style: 'width:180px' });
    const pw2 = h('input', { type: 'password', placeholder: 'Repeat', style: 'width:140px' });
    const opt = (key, label, size, note, disabled) => h('tr', { class: disabled ? 'muted' : '' },
      h('td', { style: 'width:24px;text-align:center' }, h('input', { type: 'checkbox', checked: opts[key] && !disabled, disabled: !!disabled, onchange: (e) => { opts[key] = e.target.checked; draw(); } })),
      h('td', null, h('b', null, label), h('div', { class: 'small muted' }, note)),
      h('td', { class: 'num nowrap' }, size == null ? '' : fmtBytes(size)));
    const total = selectedSize();
    const free = target && target.drive ? target.drive.free : null;
    const tooBig = free != null && total > free;

    const run = async () => {
      if (!target) return status('Choose a drive or folder first');
      if (!Object.entries(opts).some(([k, v]) => v && k !== 'protect')) return status('Nothing selected');
      if (opts.plan && opts.protect) {
        if (pw.value.length < 8) return status('Backup password: use at least 8 characters');
        if (pw.value !== pw2.value) return status('Backup passwords do not match');
      }
      if (opts.pdf && opts.protect && !(await confirmBox('The printable PDF contains your plan and is not password protected. Include it anyway?', 'Include PDF'))) return;
      busy = true;
      runBtn.disabled = true;
      cancelBtn.disabled = false;
      const pdfHtml = opts.pdf ? buildDocument(SECTIONS.map((x) => x.id)) : null;
      const go = (overwrite) => (store.flush(), window.api.usb.run(target.path, { plan: opts.plan, password: opts.plan && opts.protect ? pw.value : null, vault: opts.vault, library: opts.library, tiles: opts.tiles, app: opts.app, pdfHtml, overwrite }));
      try {
        let r;
        try { r = await go(false); } catch (e) {
          if (!errMsg(e).startsWith('USB_HAS_CHANGES')) throw e;
          // The drive was edited on another computer since the last backup.
          if (await confirmBox(errMsg(e).replace('USB_HAS_CHANGES: ', '') + ' Backing up now would overwrite them.', 'Review changes')) {
            await loadReview(target.path);
            busy = false;
            progText.textContent = '';
            return draw();
          }
          if (!(await confirmBox('Overwrite the drive and lose the changes made on the other computer?', 'Overwrite', true))) throw new Error('Cancelled');
          r = await go(true);
        }
        status('Backup finished: ' + r.path, 10000);
        await loadDrives();
        await loadReview(target.path);
        est = await window.api.usb.estimate();
      } catch (e) {
        status('Backup failed: ' + errMsg(e), 10000);
        progText.textContent = 'Failed: ' + errMsg(e);
      }
      busy = false;
      draw();
    };
    const runBtn = h('button', { class: 'primary', disabled: !target || tooBig, onclick: run, style: 'font-size:14px;padding:6px 16px' }, icon('usb-flash-drive-outline'), 'Back up now');
    const cancelBtn = h('button', { disabled: true, onclick: () => window.api.usb.cancel() }, icon('stop'), 'Cancel');

    return panel('2. What to include', h('div', { class: 'stack' },
      h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' }, h('tbody', null,
        opt('plan', 'Plan data', est.plan, 'Household, people, medical details, contacts, supplies, checklists, settings.'),
        opts.plan ? h('tr', null, h('td'), h('td', { colspan: 2 },
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: opts.protect, onchange: (e) => { opts.protect = e.target.checked; draw(); } }), 'Protect plan data with a password'),
          opts.protect ? h('div', { class: 'row', style: 'margin-top:4px' }, pw, pw2, h('span', { class: 'small muted' }, 'Needed to restore. Not stored anywhere.')) : null)) : null,
        opt('pdf', 'Printable plan (PDF)', null, 'Readable on any computer or phone without this app. Not password protected.'),
        opt('vault', 'Document vault', est.vault, est.vaultExists ? 'Copied still encrypted. Opens with your vault password or recovery code.' : 'No vault set up yet.', !est.vaultExists),
        opt('library', 'Offline library', est.library, 'Saved web pages (GOV.UK, NHS and so on).'),
        opt('tiles', 'Offline map tiles', est.tiles, 'Maps you downloaded for offline use.'),
        opt('app', 'Copy of this program', est.appAvailable ? est.app : null, est.appAvailable ? 'Run it from the drive on any Windows PC; it opens the backup directly.' : 'Only available in the installed app.', !est.appAvailable)))),
      h('div', { class: 'row' },
        runBtn, cancelBtn,
        h('span', { class: tooBig ? '' : 'muted' , style: tooBig ? 'color:var(--red)' : '' }, `About ${fmtBytes(total)}`, free != null ? ` to copy, ${fmtBytes(free)} free` : '', tooBig ? '. Not enough space.' : ''),
        h('span', { class: 'spacer' }),
        target ? h('button', { onclick: () => window.api.usb.openFolder(target.path) }, icon('folder-open-outline'), 'Open') : null),
      progBar, progText,
      h('div', { class: 'note' }, target ? `Saves into "${target.path.replace(/\\$/, '')}\\Holdfast Backup". An earlier backup there is updated.` : 'Choose a drive above.')));
  }

  function restorePanel() {
    const m = restoreFrom && restoreFrom.manifest;
    const c = (m && m.contents) || {};
    const sel = { plan: !!c.plan, vault: !!c.vault, library: !!c.library, tiles: !!c.tiles };
    const pw = h('input', { type: 'password', placeholder: 'Backup password' });
    const chk = (k, label) => c[k] ? h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: sel[k], onchange: (e) => (sel[k] = e.target.checked) }), label, c[k].fromEarlier ? h('span', { class: 'muted small' }, ` (from ${fmtDate(c[k].fromEarlier)})`) : '') : null;
    const pick = async () => {
      const r = await window.api.usb.chooseFolder('Choose the backup drive or its "Holdfast Backup" folder');
      if (!r) return;
      if (!r.manifest) return status('No backup found there', 8000);
      restoreFrom = r;
      draw();
    };
    const fromDrive = drives.filter((d) => d.manifest && d.manifest.complete);
    return panel('Restore from a backup', h('div', { class: 'stack' },
      h('div', { class: 'row' },
        fromDrive.map((d) => h('button', { onclick: () => { restoreFrom = { path: d.root, manifest: d.manifest }; draw(); } }, icon('usb-flash-drive-outline'), `${d.id} ${d.label}`)),
        h('button', { onclick: pick }, icon('folder-outline'), 'Choose folder...')),
      m ? h('div', { class: 'stack' },
        h('div', { class: 'kv small' },
          h('span', null, 'Location'), h('span', { class: 'mono' }, restoreFrom.path),
          h('span', null, 'Made'), h('span', null, fmtDate(m.created, true) + (m.computer ? ' on ' + m.computer : '')),
          h('span', null, 'App version'), h('span', null, m.appVersion || '')),
        m.complete ? null : h('div', { class: 'note warn' }, 'This backup did not finish. Some parts may be missing or older.'),
        h('div', null, chk('plan', 'Plan data' + (c.plan && c.plan.encrypted ? ' (password protected)' : '')), chk('vault', 'Document vault'), chk('library', 'Offline library'), chk('tiles', 'Map tiles')),
        c.plan && c.plan.encrypted ? pw : null,
        h('div', null, h('button', { class: 'primary', onclick: async () => {
          if (!Object.values(sel).some(Boolean)) return status('Nothing selected');
          const what = Object.entries(sel).filter(([, v]) => v).map(([k]) => ({ plan: 'plan data', vault: 'document vault', library: 'offline library', tiles: 'map tiles' }[k])).join(', ');
          if (!(await confirmBox(`Replace your current ${what} with the backup from ${fmtDate(m.created, true)}? Current plan data is kept in the data folder under "before-restore".`, 'Restore', true))) return;
          busy = true;
          try {
            const r = await window.api.usb.restore(restoreFrom.path, { ...sel, password: pw.value || null });
            status('Restored: ' + r.restored.join(', '), 10000);
            if (r.restored.includes('plan') || r.restored.includes('library')) return store.reloadFromDisk();
            est = await window.api.usb.estimate();
          } catch (e) { status('Restore failed: ' + errMsg(e), 10000); }
          busy = false;
          draw();
        } }, icon('backup-restore'), 'Restore selected'))) : h('div', { class: 'muted small' }, fromDrive.length ? 'Pick the drive to restore from.' : 'Plug in a backup drive or choose its folder.')));
  }

  await loadDrives();
  if (params.path) target = { path: params.path, label: params.path };
  if (params.review || params.drive) {
    const d = drives.find((x) => x.id === (params.review || params.drive));
    if (d) target = { path: d.root, label: `${d.id} ${d.label}`, drive: d };
  }
  if (target && (params.review || params.drive || params.path || (target.drive && target.drive.manifest))) await loadReview(target.path);
  // A drive edited elsewhere was plugged in while this page is open.
  offs.push(window.api.on('usb:sync-status', async (list) => {
    if (busy || review || !list.length) return;
    await loadDrives();
    const d = drives.find((x) => x.id === list[0].drive);
    if (d) { target = { path: d.root, label: `${d.id} ${d.label}`, drive: d }; await loadReview(d.root); draw(); }
  }));
  // A drive was plugged in, removed or ejected from the sidebar.
  offs.push(window.api.on('usb:present', async () => { if (!busy) { await loadDrives(); draw(); } }));
  draw();
  return () => offs.forEach((f) => f());
}
