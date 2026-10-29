// Removes the files left by earlier builds so dist only holds the version being built.
// Release notes (.md) are kept; win-unpacked is rebuilt by electron-builder anyway.
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  for (const f of fs.readdirSync(dist)) {
    const p = path.join(dist, f);
    if (fs.statSync(p).isFile() && !f.endsWith('.md')) fs.rmSync(p);
  }
}
