// Compiles build/launcher.cs to build/launcher.exe with the Holdfast icon, using the C# compiler that ships with Windows.
// The installed app copies it to backup drives as "Start Holdfast.exe".
// Usage: node scripts/build-launcher.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const windir = process.env.WINDIR || 'C:\\Windows';
const csc = ['Framework64', 'Framework'].map((f) => path.join(windir, 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe')).find((p) => fs.existsSync(p));
if (!csc) throw new Error('csc.exe (.NET Framework 4) not found');

execFileSync(csc, [
  '/nologo', '/target:winexe', '/optimize+',
  '/win32icon:' + path.join(ROOT, 'build', 'icon.ico'),
  '/out:' + path.join(ROOT, 'build', 'launcher.exe'),
  path.join(ROOT, 'build', 'launcher.cs'),
], { stdio: 'inherit' });
console.log('Wrote build/launcher.exe');
