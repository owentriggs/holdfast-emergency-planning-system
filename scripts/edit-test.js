// Types into Planner > Household fields with real keyboard events and checks the values stick and are saved.
// Usage: npx electron scripts/edit-test.js
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eps-edit-'));
app.setPath('userData', dataDir);
// Seed version 1 style data: two untouched starter rows and one the user filled in.
fs.mkdirSync(path.join(dataDir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'data', 'settings.json'), JSON.stringify({ targetDays: 3, winW: 1400 }));
fs.writeFileSync(path.join(dataDir, 'data', 'locations.json'), JSON.stringify([
  { id: 'a', item: 'Water stopcock (inside)', location: '', howTo: 'Turn clockwise to close.', checked: '' },
  { id: 'b', item: 'Electricity meter', location: 'Under the stairs', howTo: '', checked: '' },
  { id: 'c', item: 'Grab bag', location: '', howTo: '', checked: '' },
]));
require('../src/main/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => level >= 2 && console.log('console:', message));
  win.webContents.once('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c);
    const type = async (text) => { for (const ch of text) { win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await wait(10); } };
    const results = [];
    const check = async (label, selector, text) => {
      const rect = await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView(); const r = el.getBoundingClientRect(); return { x: r.x + 5, y: r.y + r.height / 2 }; })()`);
      if (!rect) return results.push(`${label}: NOT FOUND`);
      win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
      await wait(100);
      await type(text);
      await wait(100);
      const v = await js(`document.querySelector(${JSON.stringify(selector)}).value`);
      results.push(`${label}: ${v.includes(text) ? 'OK' : 'FAILED'} (value "${v}")`);
    };
    win.show();
    win.focus();
    await wait(1500);
    await js(`window.go('planner')`);
    await wait(800);
    for (const [label, sel, text] of JSON.parse(process.env.EPS_FIELDS || '[]')) await check(label, sel, text);
    await check('Household name', '.form input', 'Smith');
    await check('Address', '.form textarea', '1 High St');
    // Add a person, name them, then delete them through the confirm dialog and keep typing.
    await js(`document.querySelector('.tbltools button').click()`);
    await wait(300);
    await check('Person name (table)', '.tbl.edit tbody tr input', 'Alex');
    await js(`document.querySelector('.tbl.edit tbody tr td.act button.del').click()`);
    await wait(300);
    results.push('Confirm dialog shown: ' + (await js(`!!document.querySelector('dialog[open]')`)));
    await js(`document.querySelector('dialog[open] button.primary').click()`);
    await wait(300);
    results.push('Person deleted: ' + (await js(`document.querySelectorAll('.tbl.edit tbody tr:not(.empty)').length === 0`)));
    await check('Typing after dialog', '.form input', ' family');
    // Migration: starter rows the user never touched are removed, edited ones kept.
    await js(`window.go('planner')`);
    const loc = JSON.parse(fs.readFileSync(path.join(dataDir, 'data', 'locations.json'), 'utf8'));
    results.push('Locations after migration: ' + JSON.stringify(loc.map((r) => r.item + ' @ ' + r.location)));
    await wait(1000);
    console.log(results.join('\n'));
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'data', 'household.json'), 'utf8'));
    console.log('saved:', JSON.stringify({ name: saved.name, address: saved.address, postcode: saved.postcode, people: saved.people.map((p) => p.name) }));
    app.exit(0);
  });
});
