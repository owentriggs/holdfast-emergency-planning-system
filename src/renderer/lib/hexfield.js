// Hexagon pattern in the logo's reds: the PDF cover and the installer artwork (scripts/build-installer-art.js reads
// this file as text, so keep it to this one plain function).
// w, h: size in the SVG's units. r: hexagon radius. from: 'top' or 'right', the edge where the pattern is densest,
// fading towards the opposite one. unit: 'mm' or 'px' for the width and height attributes. density: share of filled hexagons.
export function hexField(w, h, r, { from = 'top', unit = 'mm', seed = 11, density = 0.16 } = {}) {
  const dx = Math.sqrt(3) * r;
  const dy = 1.5 * r;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tints = ['#b3261e', '#8f1d17', '#d9534f', '#e8a19c'];
  let out = '';
  for (let row = -1; row * dy < h + r; row++) {
    for (let col = -1; col * dx < w + dx; col++) {
      const cx = col * dx + (row % 2 ? dx / 2 : 0);
      const cy = row * dy;
      const fade = Math.max(0, from === 'right' ? cx / w : 1 - cy / h) ** 1.4;
      if (fade <= 0.02) continue;
      const pts = [0, 1, 2, 3, 4, 5].map((i) => {
        const a = (Math.PI / 180) * (60 * i - 30);
        return `${(cx + r * 0.94 * Math.cos(a)).toFixed(2)},${(cy + r * 0.94 * Math.sin(a)).toFixed(2)}`;
      }).join(' ');
      const fill = rnd() < density * fade ? tints[Math.floor(rnd() * tints.length)] : 'none';
      const op = fill === 'none' ? 0 : (0.25 + 0.75 * rnd()) * fade;
      out += `<polygon points="${pts}" fill="${fill}" fill-opacity="${op.toFixed(2)}" stroke="#b3261e" stroke-opacity="${(0.32 * fade).toFixed(2)}" stroke-width="${(r / 30).toFixed(2)}"/>`;
    }
  }
  return `<svg class="hex" width="${w}${unit}" height="${h}${unit}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
}
