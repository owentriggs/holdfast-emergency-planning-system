// Phone app only (web/api.js): bring the plan in from the computer's phone file, and send edits back as a changes file.
import * as store from '../lib/store.js';
import { h, panel, status, fmtDate, confirmBox, promptForm, icon } from '../lib/ui.js';

const errMsg = (e) => String(e.message || e);

// Asks for the backup password when the file is protected, and again if it was wrong.
async function withPassword(run) {
  let password = null;
  for (;;) {
    try { return await run(password); } catch (e) {
      const msg = errMsg(e);
      if (!/^PASSWORD_(NEEDED|WRONG)/.test(msg)) throw e;
      const f = await promptForm(msg.startsWith('PASSWORD_WRONG') ? 'Password not correct. Try again' : 'Backup password', [{ key: 'pw', label: 'The password set for the USB backup', type: 'password' }], 'OK');
      if (!f) return null;
      password = f.pw;
    }
  }
}

export async function render(root) {
  let copy = await window.api.phone.status();
  const busy = h('div', { class: 'muted small', style: 'min-height:16px' });

  const openFile = () => {
    const input = h('input', { type: 'file' });
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      if (copy && copy.changed && !(await confirmBox('This phone has edits that have not been sent to the computer. Opening another phone file replaces them. Continue?', 'Replace', true))) return;
      busy.textContent = 'Opening ' + file.name + '... (a protected file takes a few seconds)';
      try {
        const r = await withPassword((pw) => window.api.phone.importFile(file, pw));
        if (!r) { busy.textContent = ''; return; }
        status('Opened the plan from ' + (r.computer || 'the computer'));
        store.reloadFromDisk();
      } catch (e) { busy.textContent = 'Could not open: ' + errMsg(e); }
    };
    input.click();
  };

  const sendChanges = async () => {
    store.flush();
    busy.textContent = 'Making the changes file...';
    try {
      const out = await withPassword((pw) => window.api.phone.exportChanges(pw));
      if (!out) { busy.textContent = ''; return; }
      const r = await window.api.phone.save(out);
      busy.textContent = r.ok ? `Saved "${out.name}". ${r.shared ? '' : 'It is in your Downloads. '}Copy it into the "Holdfast Backup" folder on the USB drive, or send it to the computer.` : '';
      copy = await window.api.phone.status();
      draw();
    } catch (e) { busy.textContent = 'Could not save: ' + errMsg(e); }
  };

  function draw() {
    root.replaceChildren(h('div', { class: 'grid g2' },
      h('div', { class: 'stack' },
        panel('On this phone', copy ? h('div', { class: 'stack' },
          h('div', { class: 'kv' },
            h('span', null, 'From'), h('span', null, copy.computer || 'Computer'),
            h('span', null, 'Copy made'), h('span', null, fmtDate(copy.created, true)),
            h('span', null, 'Opened here'), h('span', null, fmtDate(copy.importedAt, true)),
            h('span', null, 'Protected'), h('span', null, copy.encrypted ? 'Yes, with the backup password' : 'No'),
            h('span', null, 'Edits'), h('span', null, copy.changed ? h('span', { class: 'pill warn' }, 'Not sent to the computer yet') : copy.exportedAt ? 'Sent ' + fmtDate(copy.exportedAt, true) : 'None')),
          h('div', { class: 'row' },
            h('button', { class: 'primary', onclick: sendChanges }, icon('export'), 'Save changes for the computer'),
            h('button', { onclick: openFile }, icon('file-upload-outline'), 'Open a newer phone file')),
          busy) : h('div', { class: 'stack' },
          h('div', null, 'Nothing here yet. Open the phone file from your USB backup to bring your plan and document vault onto this phone.'),
          h('div', null, h('button', { class: 'primary', onclick: openFile }, icon('file-upload-outline'), 'Open phone file...')),
          busy))),
      h('div', { class: 'stack' },
        panel('How it works', h('ol', { class: 'small', style: 'margin:0;padding-left:18px;line-height:1.7' },
          h('li', null, 'On the computer, open USB backup, tick "Copy for the phone app" and back up.'),
          h('li', null, 'Plug the USB drive into the phone (a USB-C drive or an adapter). Tap "Open phone file" and choose "Holdfast phone.holdfast" in the "Holdfast Backup" folder.'),
          h('li', null, 'Everything then works on the phone without signal. The document vault stays encrypted and opens with its usual password.'),
          h('li', null, 'After editing, tap "Save changes for the computer" and save the file onto the USB drive. The computer finds it on the USB backup page and lets you review the changes before merging.'))),
        h('div', { class: 'note' }, 'Your plan is stored only in this browser on this phone, not online. Clearing the browser\'s site data removes it. Add the app to your home screen so it opens like an app and keeps working offline.'))));
  }
  draw();
}
