// Weather map: rain radar loop, forecast fields (rain, gusts with wind arrows, temperature, pressure) over a time
// slider, nearby flood warning areas and active tropical storms. Everything shown is saved for offline use.
import * as store from '../lib/store.js';
import { h, status, fmtDate, fmtBytes, confirmBox, icon, summary } from '../lib/ui.js';

// Colour stops [value, r, g, b, alpha] for each forecast field.
const FIELDS = {
  rain: { label: 'Rain', v: 'precipitation', unit: 'mm/h', stops: [[0, 120, 170, 230, 0], [0.1, 150, 200, 250, 0.45], [1, 50, 120, 230, 0.7], [4, 30, 170, 80, 0.75], [8, 240, 190, 30, 0.8], [16, 220, 40, 30, 0.85]] },
  gust: { label: 'Gusts', v: 'wind_gusts_10m', unit: 'mph', stops: [[0, 160, 210, 170, 0.15], [20, 160, 210, 170, 0.4], [35, 240, 210, 60, 0.6], [50, 240, 130, 40, 0.7], [70, 210, 30, 30, 0.75], [90, 130, 30, 160, 0.8]] },
  temp: { label: 'Temperature', v: 'temperature_2m', unit: '°C', stops: [[-10, 100, 60, 190, 0.6], [0, 60, 140, 240, 0.6], [10, 90, 190, 160, 0.55], [20, 240, 210, 60, 0.6], [30, 220, 60, 30, 0.65]] },
  pressure: { label: 'Pressure', v: 'pressure_msl', unit: 'hPa', stops: [[960, 110, 40, 160, 0.7], [985, 50, 110, 220, 0.6], [1000, 150, 200, 240, 0.45], [1013, 235, 235, 235, 0.2], [1025, 240, 190, 120, 0.45], [1040, 220, 110, 50, 0.6]] },
};
const FLOOD_COLOURS = { 1: '#b3261e', 2: '#d9480f', 3: '#c98a00' };

function colourAt(stops, v) {
  if (v == null) return [0, 0, 0, 0];
  if (v <= stops[0][0]) return stops[0].slice(1);
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i];
      const t = (v - a[0]) / (b[0] - a[0]);
      return a.slice(1).map((c, k) => c + (b[k + 1] - c) * t);
    }
  }
  return stops.at(-1).slice(1);
}

const hourLabel = (unix) => new Date(unix * 1000).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function render(root, { hh, st }) {
  const mapEl = h('div', { id: 'map', style: 'height:calc(100vh - 200px);flex:none' });
  const slider = h('input', { type: 'range', min: 0, max: 0, value: 0, style: 'flex:1;min-width:120px;max-width:280px' });
  const timeEl = h('span', { class: 'mono', style: 'min-width:120px;display:inline-block' });
  const playBtn = h('button', { title: 'Play' }, icon('play'));
  const readout = h('span', { class: 'mono muted' });
  const legendEl = h('div', { class: 'row small', style: 'gap:6px' });
  const gridSel = h('select');
  const statsEl = h('span', { class: 'muted' });
  const prog = h('div', { class: 'progress' }, h('i'));
  const stormInfo = h('span', { class: 'muted' });
  const showFloods = { on: true }, showStorms = { on: true };

  const map = L.map(mapEl, { zoomControl: true }).setView(hh.lat ? [hh.lat, hh.lon] : [54.5, -3.5], hh.lat ? 7 : 6);
  L.control.scale({ imperial: true, metric: true }).addTo(map);
  L.tileLayer('tile://topo/{z}/{x}/{y}', { maxZoom: 17, opacity: 0.6, attribution: '&copy; OpenStreetMap contributors, OpenTopoMap | Radar &copy; RainViewer | Forecast Open-Meteo' }).addTo(map);
  const fieldLayer = L.layerGroup().addTo(map);
  const arrowLayer = L.layerGroup().addTo(map);
  const floodLayer = L.layerGroup().addTo(map);
  const stormLayer = L.layerGroup().addTo(map);
  if (hh.lat) L.circleMarker([hh.lat, hh.lon], { radius: 6, color: '#000', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(map);

  let mode = st.wxMapLayer && (st.wxMapLayer === 'radar' || FIELDS[st.wxMapLayer]) ? st.wxMapLayer : 'radar';
  let frames = [];
  const radarLayers = new Map();
  let grid = null;
  let timer = null;

  const modeBtns = h('div', { class: 'row', style: 'gap:0' }, [['radar', 'Radar'], ...Object.entries(FIELDS).map(([k, f]) => [k, f.label])].map(([k, label]) =>
    h('button', { dataset: { mode: k }, onclick: () => setMode(k) }, label)));

  // Radar: one tile layer per frame, all kept on the map so the loop plays without reloading.
  const showFrame = (i) => {
    const f = frames[i];
    if (!f) return;
    if (!radarLayers.has(f.key)) radarLayers.set(f.key, L.tileLayer(`wx://radar/${f.key}/{z}/{x}/{y}`, { maxNativeZoom: 7, maxZoom: 17, opacity: 0, zIndex: 5 }).addTo(map));
    for (const [k, l] of radarLayers) l.setOpacity(k === f.key ? 0.75 : 0);
    timeEl.textContent = hourLabel(f.time);
  };
  const hideRadar = () => radarLayers.forEach((l) => l.setOpacity(0));

  // Forecast field: one pixel per grid point, stretched over the area so the browser smooths between points.
  const drawField = (hour) => {
    fieldLayer.clearLayers();
    arrowLayer.clearLayers();
    const f = FIELDS[mode];
    if (!grid || !f) return;
    const { lats, lons, vars } = grid;
    const nx = lons.length, ny = lats.length;
    const cv = document.createElement('canvas');
    cv.width = nx;
    cv.height = ny;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(nx, ny);
    let lo = { v: Infinity }, hi = { v: -Infinity };
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
      const p = r * nx + c;
      const v = vars[f.v][p][hour];
      if (v != null && v < lo.v) lo = { v, p };
      if (v != null && v > hi.v) hi = { v, p };
      const [R, G, B, A] = colourAt(f.stops, v);
      const o = ((ny - 1 - r) * nx + c) * 4; // row 0 of the image is the north edge
      img.data.set([R, G, B, Math.round(A * 255)], o);
    }
    ctx.putImageData(img, 0, 0);
    const dLat = (lats[1] - lats[0]) / 2, dLon = (lons[1] - lons[0]) / 2;
    L.imageOverlay(cv.toDataURL(), [[lats[0] - dLat, lons[0] - dLon], [lats.at(-1) + dLat, lons.at(-1) + dLon]], { opacity: 1, zIndex: 4, className: 'wxfield' }).addTo(fieldLayer);
    const at = (p) => [lats[Math.floor(p / nx)], lons[p % nx]];
    if (mode === 'gust' || mode === 'rain') {
      // Arrows point the way the wind is blowing, sized by its mean speed.
      for (let p = 0; p < nx * ny; p++) {
        const r = Math.floor(p / nx), c = p % nx;
        if (r % 2 || c % 2) continue;
        const dir = vars.wind_direction_10m[p][hour], spd = vars.wind_speed_10m[p][hour];
        if (dir == null || spd == null) continue;
        const size = Math.round(10 + Math.min(spd, 50) / 3);
        L.marker(at(p), { interactive: false, icon: L.divIcon({ className: 'wxarrow', iconSize: [size, size], html: `<i class="mdi mdi-navigation" style="font-size:${size}px;transform:rotate(${dir + 180}deg)"></i>` }) }).addTo(arrowLayer);
      }
    }
    if (mode === 'pressure' && Number.isFinite(lo.v)) {
      L.marker(at(lo.p), { interactive: false, icon: L.divIcon({ className: 'wxcentre low', iconSize: [40, 30], html: `L<small>${Math.round(lo.v)}</small>` }) }).addTo(arrowLayer);
      L.marker(at(hi.p), { interactive: false, icon: L.divIcon({ className: 'wxcentre', iconSize: [40, 30], html: `H<small>${Math.round(hi.v)}</small>` }) }).addTo(arrowLayer);
    }
    timeEl.textContent = hourLabel(grid.time[hour]);
  };

  const drawLegend = () => {
    const f = FIELDS[mode];
    if (!f) return legendEl.replaceChildren(h('span', { class: 'muted' }, 'Rain radar, last 2 hours. Light to heavy:'), h('span', { class: 'wxscale', style: 'background:linear-gradient(90deg,#9fd3ff,#3a8ee8,#1650c8,#f0c020,#e03020)' }));
    const grad = f.stops.map((s, i) => `rgba(${s.slice(1, 4).join(',')},${Math.max(0.35, s[4])}) ${(i / (f.stops.length - 1)) * 100}%`).join(',');
    legendEl.replaceChildren(h('span', null, f.stops[0][0]), h('span', { class: 'wxscale', style: `background:linear-gradient(90deg,${grad})` }), h('span', null, f.stops.at(-1)[0] + ' ' + f.unit),
      ...(mode === 'gust' || mode === 'rain' ? [h('span', { class: 'muted' }, ' Arrows: wind direction, bigger is stronger')] : []));
  };

  const sync = () => {
    stop();
    modeBtns.querySelectorAll('button').forEach((b) => b.classList.toggle('primary', b.dataset.mode === mode));
    drawLegend();
    if (mode === 'radar') {
      fieldLayer.clearLayers();
      arrowLayer.clearLayers();
      slider.max = Math.max(0, frames.length - 1);
      slider.value = slider.max;
      if (frames.length) showFrame(frames.length - 1);
      else timeEl.textContent = st.offlineMode || !navigator.onLine ? 'No radar saved' : 'No radar';
    } else {
      hideRadar();
      if (!grid) {
        fieldLayer.clearLayers();
        arrowLayer.clearLayers();
        timeEl.textContent = 'No forecast saved';
        slider.max = 0;
        return;
      }
      slider.max = grid.time.length - 1;
      const now = Date.now() / 1000;
      const i = grid.time.findIndex((t) => t + 1800 >= now);
      slider.value = i < 0 ? grid.time.length - 1 : i;
      drawField(Number(slider.value));
    }
  };
  const setMode = (k) => {
    mode = k;
    st.wxMapLayer = k;
    store.save('settings');
    sync();
  };
  slider.oninput = () => (mode === 'radar' ? showFrame(Number(slider.value)) : drawField(Number(slider.value)));

  const stop = () => {
    clearInterval(timer);
    timer = null;
    playBtn.replaceChildren(icon('play'));
  };
  playBtn.onclick = () => {
    if (timer) return stop();
    playBtn.replaceChildren(icon('pause'));
    timer = setInterval(() => {
      const max = Number(slider.max);
      slider.value = Number(slider.value) >= max ? 0 : Number(slider.value) + (mode === 'radar' ? 1 : 3);
      slider.oninput();
    }, mode === 'radar' ? 600 : 400);
  };

  // Value under the pointer, from the nearest forecast point.
  map.on('mousemove', (e) => {
    const f = FIELDS[mode];
    let txt = `${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)}`;
    if (f && grid) {
      const { lats, lons } = grid;
      const r = Math.round(((e.latlng.lat - lats[0]) / (lats.at(-1) - lats[0])) * (lats.length - 1));
      const c = Math.round(((e.latlng.lng - lons[0]) / (lons.at(-1) - lons[0])) * (lons.length - 1));
      if (r >= 0 && r < lats.length && c >= 0 && c < lons.length) {
        const p = r * lons.length + c, hr = Number(slider.value);
        const v = grid.vars[f.v][p][hr];
        txt += `  ${f.label}: ${v ?? '-'} ${f.unit}`;
        if (mode === 'gust') txt += `, wind ${grid.vars.wind_speed_10m[p][hr]} mph`;
      }
    }
    readout.textContent = txt;
  });

  // Saved forecasts, newest first. The one covering the middle of the view is picked unless one was chosen.
  let grids = [];
  const covers = (m, ll) => ll.lat >= m.bounds.south && ll.lat <= m.bounds.north && ll.lng >= m.bounds.west && ll.lng <= m.bounds.east;
  const loadGrids = async (pick) => {
    grids = await window.api.wx.grids();
    const c = map.getCenter();
    const chosen = grids.find((m) => m.id === pick) || grids.find((m) => covers(m, c)) || grids[0];
    gridSel.replaceChildren(...(grids.length ? grids.map((m) => h('option', { value: m.id, selected: m === chosen },
      `Forecast ${fmtDate(m.at, true)}${covers(m, c) ? '' : ' (other area)'}`)) : [h('option', { value: '' }, 'No forecast saved')]));
    grid = chosen ? await window.api.wx.grid(chosen.id).catch(() => null) : null;
    sync();
  };
  gridSel.onchange = () => loadGrids(gridSel.value);

  const bounds = () => {
    const b = map.getBounds();
    return { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
  };
  const online = () => !st.offlineMode && navigator.onLine;

  // auto: the background refresh on opening, which leaves the chosen layer alone.
  const fetchGrid = async (auto) => {
    if (!online()) return status('Offline: showing saved forecasts');
    status('Downloading forecast for this area...', 0);
    try {
      const m = await window.api.wx.fetchGrid(bounds());
      status('Forecast saved');
      if (!auto && mode === 'radar') mode = 'rain';
      await loadGrids(m.id);
    } catch (e) {
      status('Forecast download failed: ' + e.message, 8000);
    }
    refreshStats();
  };

  const loadRadar = async () => {
    try {
      frames = await window.api.wx.radarFrames();
    } catch (e) {
      status('Radar unavailable: ' + e.message, 8000);
    }
    if (mode === 'radar') sync();
  };

  const drawFloods = async () => {
    floodLayer.clearLayers();
    const flood = store.get('floodCache');
    if (!showFloods.on || !flood) return;
    const items = flood.items.filter((f) => f.areaId);
    const areas = await window.api.wx.floodAreas(items.map((f) => f.areaId));
    for (const f of items) {
      if (!areas[f.areaId]) continue;
      const col = FLOOD_COLOURS[f.level] || '#666';
      L.geoJSON(areas[f.areaId], { style: { color: col, weight: 1.5, fillColor: col, fillOpacity: 0.3 } })
        .bindTooltip(`${f.severity}: ${f.desc}`).addTo(floodLayer);
    }
  };

  const drawStorms = async () => {
    stormLayer.clearLayers();
    if (!showStorms.on) return;
    const s = await window.api.wx.storms();
    for (const t of s?.storms || []) {
      if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
      const mph = Math.round(t.intensity * 1.15078);
      L.marker([t.lat, t.lon], { icon: L.divIcon({ className: 'wxstorm', iconSize: [26, 26], html: '<i class="mdi mdi-weather-hurricane"></i>' }) })
        .bindTooltip(`${t.name} (${t.classification})<br>${mph} mph, ${t.pressure} hPa<br>Moving ${t.movementDir}° at ${Math.round(t.movementSpeed * 1.15078)} mph<br>${fmtDate(t.lastUpdate, true)}`).addTo(stormLayer);
    }
    stormInfo.textContent = s ? `${s.storms.length} tropical storm${s.storms.length === 1 ? '' : 's'} active` : '';
  };

  const refreshStats = async () => {
    const s = await window.api.wx.stats();
    statsEl.replaceChildren(summary(`${s.forecasts} forecast${s.forecasts === 1 ? '' : 's'}`, `${s.radarFrames} radar frames`, fmtBytes(s.bytes)));
  };

  const off = window.api.on('wx:progress', (p) => {
    prog.firstChild.style.width = p.finished ? '0' : `${(p.done / Math.max(1, p.total)) * 100}%`;
    status(p.finished ? `Radar saved: ${p.done} tiles` : `Saving radar ${p.done}/${p.total}`, p.finished ? 6000 : 0);
    if (p.finished) loadRadar().then(refreshStats);
  });

  const chk = (o, label, fn) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: o.on, onchange: (e) => { o.on = e.target.checked; fn(); } }), label);

  root.append(
    h('div', { class: 'row', style: 'margin-bottom:6px;flex-wrap:wrap' },
      modeBtns, playBtn, slider, timeEl,
      gridSel,
      h('button', { title: 'Delete this saved forecast', onclick: async () => { if (gridSel.value) { await window.api.wx.removeGrid(gridSel.value); loadGrids(); refreshStats(); } } }, icon('delete-outline')),
      h('button', { class: 'primary', onclick: () => fetchGrid(false) }, icon('download'), 'Forecast for this view'),
      h('button', { title: 'Save the current radar loop for this view at zoom 5 to 7', onclick: async () => {
        if (!online()) return status('Offline: showing saved radar');
        try { await window.api.wx.downloadRadar(bounds()); } catch (e) { status(e.message, 8000); }
      } }, 'Save radar')),
    prog,
    mapEl,
    h('div', { class: 'row small', style: 'padding-top:3px;flex-wrap:wrap' },
      legendEl, h('span', { class: 'spacer' }),
      chk(showFloods, 'Flood warnings', drawFloods), chk(showStorms, 'Tropical storms', drawStorms), stormInfo,
      readout),
    h('div', { class: 'row small', style: 'padding-top:3px' },
      h('span', { class: 'muted' }, 'Forecasts and radar you view are saved for offline use. Radar older than 2 days and forecasts older than ' + (st.weatherKeepDays || 14) + ' days are deleted automatically.'),
      h('span', { class: 'spacer' }), statsEl,
      h('button', { class: 'small danger', onclick: async () => { if (await confirmBox('Delete all saved weather maps, radar and forecasts?', 'Delete', true)) { await window.api.wx.clear(); frames = []; grid = null; await loadGrids(); loadRadar(); refreshStats(); } } }, 'Clear')));

  setTimeout(async () => {
    map.invalidateSize();
    await loadGrids();
    await loadRadar();
    drawFloods();
    drawStorms();
    refreshStats();
    // Keep a recent forecast for the area without being asked, like the point forecast.
    const newest = grids.find((m) => covers(m, map.getCenter()));
    if (st.autoCheckWeather && online() && (!newest || Date.now() - new Date(newest.at) > 3 * 3600000)) fetchGrid(true);
  }, 50);

  return () => { stop(); off(); map.remove(); };
}
