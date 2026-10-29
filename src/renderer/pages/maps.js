import * as store from '../lib/store.js';
import { h, panel, editTable, status, fmtBytes, promptForm, confirmBox, icon } from '../lib/ui.js';

const TYPES = {
  'Meeting point': '#c0392b',
  Shelter: '#7a4fb0',
  'Water source': '#2f6fbf',
  Hospital: '#e05a9a',
  Pharmacy: '#2a8c8c',
  Defibrillator: '#2e8540',
  'Fuel / supplies': '#c98a00',
  Hazard: '#000000',
  Other: '#666666',
};

export async function render(root) {
  const st = store.settings();
  const hh = store.get('household');
  const markers = store.get('markers');
  const sources = await window.api.tiles.sources();
  if (!sources[st.mapSource]) st.mapSource = Object.keys(sources)[0];

  const mapEl = h('div', { id: 'map' });
  const coordEl = h('span', { class: 'mono muted' });
  const dlInfo = h('span', { class: 'muted' });
  const statsEl = h('span', { class: 'muted' });
  const prog = h('div', { class: 'progress' }, h('i'));
  const maxZ = h('select', null, [12, 13, 14, 15, 16].map((z) => h('option', { value: z, selected: z === 15 }, 'to zoom ' + z)));
  const tableBox = h('div');

  const map = L.map(mapEl, { zoomControl: true, attributionControl: true }).setView(hh.lat ? [hh.lat, hh.lon] : [52.35, -3.7], hh.lat ? 14 : 8);
  L.control.scale({ imperial: true, metric: true }).addTo(map);
  let layer;
  const setSource = (id) => {
    if (layer) map.removeLayer(layer);
    const s = sources[id];
    layer = L.tileLayer(`tile://${id}/{z}/{x}/{y}`, { maxZoom: s.maxZoom, attribution: s.attribution }).addTo(map);
  };
  setSource(st.mapSource);

  const markerLayer = L.layerGroup().addTo(map);
  const drawMarkers = () => {
    markerLayer.clearLayers();
    if (hh.lat) L.circleMarker([hh.lat, hh.lon], { radius: 8, color: '#000', weight: 2, fillColor: '#fff', fillOpacity: 1 }).bindTooltip('Home: ' + (hh.postcode || '')).addTo(markerLayer);
    for (const m of store.get('meeting')) if (m.lat && m.lon)
      L.circleMarker([m.lat, m.lon], { radius: 7, color: '#fff', weight: 2, fillColor: TYPES['Meeting point'], fillOpacity: 1 }).bindTooltip(`${m.type}: ${m.name || ''}`).addTo(markerLayer);
    for (const m of markers) if (m.lat != null && m.lon != null && m.lat !== '' && m.lon !== '')
      L.circleMarker([m.lat, m.lon], { radius: 6, color: '#fff', weight: 2, fillColor: TYPES[m.type] || '#666', fillOpacity: 1 })
        .bindTooltip(`${m.type}: ${m.name || ''}`).bindPopup(`<b>${escapeHtml(m.name || '')}</b><br>${escapeHtml(m.type)}<br>${escapeHtml(m.notes || '')}`).addTo(markerLayer);
  };
  drawMarkers();

  map.on('mousemove', (e) => (coordEl.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}  z${map.getZoom()}`));
  map.on('contextmenu', async (e) => {
    const v = await promptForm(`Add marker at ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`, [
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type', type: 'select', options: Object.keys(TYPES) },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ], 'Add marker');
    if (!v) return;
    markers.push({ id: Math.random().toString(36).slice(2, 10), name: v.name, type: v.type, lat: +e.latlng.lat.toFixed(6), lon: +e.latlng.lng.toFixed(6), notes: v.notes });
    store.save('markers');
    drawMarkers();
    drawTable();
  });
  const updateEstimate = async () => {
    const b = map.getBounds();
    const z1 = Math.min(map.getZoom(), Number(maxZ.value));
    const est = await window.api.tiles.estimate({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() }, z1, Number(maxZ.value));
    dlInfo.textContent = `Visible area, zoom ${z1}-${maxZ.value}: ${est.count.toLocaleString()} tiles${est.count > est.cap ? ` (over limit of ${est.cap.toLocaleString()}; zoom in)` : ''}`;
  };
  map.on('moveend', updateEstimate);
  maxZ.onchange = updateEstimate;

  const refreshStats = async () => {
    const s = await window.api.tiles.stats();
    statsEl.textContent = `Tile cache: ${s.files.toLocaleString()} tiles, ${fmtBytes(s.bytes)}`;
  };

  const off = window.api.on('tiles:progress', (p) => {
    const total = p.done + p.remaining;
    prog.firstChild.style.width = p.finished ? '0' : `${(p.done / Math.max(1, total)) * 100}%`;
    status(p.finished ? `Download ${p.cancelled ? 'stopped' : 'complete'}: ${p.fetched} new tiles, ${p.failed} failed` : `Downloading tiles ${p.done}/${total} (${p.fetched} new)`, p.finished ? 8000 : 0);
    if (p.finished) refreshStats();
  });

  const drawTable = () => tableBox.replaceChildren(editTable([
    { key: 'name', label: 'Name', width: '150px' },
    { key: 'type', label: 'Type', type: 'select', options: Object.keys(TYPES), width: '120px' },
    { key: 'lat', label: 'Lat', type: 'number', width: '85px' },
    { key: 'lon', label: 'Lon', type: 'number', width: '85px' },
    { key: 'notes', label: 'Notes' },
  ], markers, () => { store.save('markers'); drawMarkers(); }, {
    addLabel: 'Add marker', newRow: () => { const c = map.getCenter(); return { type: 'Other', lat: +c.lat.toFixed(6), lon: +c.lng.toFixed(6) }; },
    actions: (r) => h('button', { title: 'Show on map', onclick: () => r.lat != null && map.setView([r.lat, r.lon], Math.max(map.getZoom(), 15)) }, icon('crosshairs-gps')),
  }));
  drawTable();

  root.append(
    h('div', { class: 'row', style: 'margin-bottom:6px' },
      h('select', { onchange: (e) => { st.mapSource = e.target.value; store.save('settings'); setSource(e.target.value); } },
        Object.entries(sources).map(([k, s]) => h('option', { value: k, selected: k === st.mapSource }, s.name))),
      h('button', { onclick: () => hh.lat ? map.setView([hh.lat, hh.lon], 15) : status('Set the home postcode on the Plan page first') }, icon('home-outline'), 'Home'),
      h('span', { style: 'width:12px' }),
      h('b', null, 'Save for offline:'), maxZ,
      h('button', { class: 'primary', onclick: async () => {
        if (st.offlineMode) return status('Turn off offline mode in Settings to download');
        const b = map.getBounds();
        const z1 = Math.min(map.getZoom(), Number(maxZ.value));
        const bounds = { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
        const est = await window.api.tiles.estimate(bounds, z1, Number(maxZ.value));
        if (est.count > est.cap) return status(`Too many tiles (${est.count}). Zoom in or lower the max zoom.`, 8000);
        if (!(await confirmBox(`Download up to ${est.count} tiles for the visible area (zoom ${z1} to ${maxZ.value})? Tiles already saved are skipped.`, 'Download'))) return;
        try { await window.api.tiles.download(st.mapSource, bounds, z1, Number(maxZ.value)); } catch (e) { status(e.message, 8000); }
      } }, icon('download'), 'Download visible area'),
      h('button', { onclick: () => window.api.tiles.cancel() }, icon('stop'), 'Stop'),
      dlInfo,
      h('span', { class: 'spacer' }),
      statsEl,
      h('button', { class: 'small danger', onclick: async () => { if (await confirmBox('Delete all saved map tiles?', 'Delete', true)) { await window.api.tiles.clear(); refreshStats(); } } }, icon('delete-sweep-outline'), 'Clear cache')),
    prog,
    h('div', { class: 'split', style: 'flex:1;min-height:0;margin-top:4px' },
      h('div', { class: 'body' }, mapEl, h('div', { class: 'row small', style: 'padding-top:3px' }, coordEl, h('span', { class: 'spacer' }), h('span', { class: 'muted' }, 'Right-click the map to add a marker. Tiles you view are saved automatically.'))),
      h('div', { class: 'side scroll', style: 'width:520px' },
        panel('Markers', tableBox),
        panel('Legend', h('div', { class: 'maplegend row' },
          h('span', null, icon('home-circle-outline'), ' Home'),
          Object.entries(TYPES).map(([k, c]) => h('span', null, h('span', { style: `display:inline-block;width:10px;height:10px;border-radius:50%;background:${c};margin-right:3px` }), k)))),
        h('div', { class: 'note' }, 'Default maps: OpenTopoMap (OpenStreetMap data with contours), a free volunteer-run service. Area downloads are capped and paced to stay within fair use. For larger areas, add a tile provider whose terms allow offline caching in Settings (custom tile URL). Meeting points with coordinates from the Planner are shown in red.'))));

  setTimeout(() => { map.invalidateSize(); updateEstimate(); }, 50);
  refreshStats();
  return () => { off(); map.remove(); };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
