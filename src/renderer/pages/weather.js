import * as store from '../lib/store.js';
import { h, panel, status, fmtDate, chart, table, COLORS, icon } from '../lib/ui.js';

// WMO weather interpretation codes used by Open-Meteo.
export const WMO = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Heavy freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Heavy freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, heavy hail',
};

const REGIONS = {
  UK: 'All UK', wl: 'Wales', se: 'London and South East', sw: 'South West England', wm: 'West Midlands', em: 'East Midlands',
  ee: 'East of England', yh: 'Yorkshire and Humber', nw: 'North West England', ne: 'North East England',
  dg: 'SW Scotland, Lothian Borders', st: 'Strathclyde', ta: 'Central, Tayside and Fife', gr: 'Grampian', hi: 'Highlands and Eilean Siar', or: 'Orkney and Shetland', ni: 'Northern Ireland',
};

export async function fetchForecast(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&hourly=temperature_2m,apparent_temperature,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset,uv_index_max' +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,relative_humidity_2m,pressure_msl' +
    '&timezone=Europe%2FLondon&wind_speed_unit=mph&forecast_days=7';
  const data = await window.api.net.get(url, 'json');
  const cache = { at: new Date().toISOString(), lat, lon, data };
  store.set('weatherCache', cache);
  return cache;
}

export async function fetchWarnings(region) {
  const url = `https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/${region}`;
  const xml = await window.api.net.get(url, 'text');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const items = [...doc.querySelectorAll('item')].map((i) => ({
    title: i.querySelector('title')?.textContent || '',
    description: i.querySelector('description')?.textContent || '',
    link: i.querySelector('link')?.textContent || '',
    date: i.querySelector('pubDate')?.textContent || '',
  }));
  const cache = { at: new Date().toISOString(), region, items };
  store.set('warningsCache', cache);
  return cache;
}

export async function fetchFloods(lat, lon) {
  const url = `https://environment.data.gov.uk/flood-monitoring/id/floods?lat=${lat}&long=${lon}&dist=25`;
  const data = await window.api.net.get(url, 'json');
  const cache = { at: new Date().toISOString(), items: (data.items || []).map((f) => ({ area: f.eaAreaName, desc: f.description, severity: f.severity, level: f.severityLevel, msg: f.message, changed: f.timeMessageChanged })) };
  store.set('floodCache', cache);
  return cache;
}

export function render(root) {
  const st = store.settings();
  const hh = store.get('household');
  const charts = [];
  const body = h('div', { class: 'stack' });

  const draw = () => {
    charts.splice(0).forEach((c) => c.destroy());
    const wc = store.get('weatherCache');
    const warn = store.get('warningsCache');
    const flood = store.get('floodCache');
    body.replaceChildren();
    if (!hh.lat) body.append(h('div', { class: 'note warn' }, 'Set your postcode on Plan > Household to get a local forecast.'));

    // Warnings
    const warnBody = !warn ? h('div', { class: 'muted' }, 'Not fetched yet.') : warn.items.length
      ? table([
        { label: 'Warning', get: (r) => h('b', { style: /red/i.test(r.title) ? 'color:var(--red)' : /amber/i.test(r.title) ? 'color:var(--amber)' : '' }, r.title) },
        { label: 'Details', get: (r) => r.description.replace(/<[^>]+>/g, '') },
        { label: 'Issued', get: (r) => fmtDate(r.date, true) },
      ], warn.items)
      : h('div', { class: 'pill ok' }, 'No warnings in force for ' + REGIONS[warn.region]);
    body.append(panel(`Met Office warnings: ${REGIONS[st.metRegion]}` + (warn ? `  (fetched ${fmtDate(warn.at, true)})` : ''), warnBody,
      h('select', { onchange: (e) => { st.metRegion = e.target.value; store.save('settings'); refresh(['warn']); } }, Object.entries(REGIONS).map(([k, v]) => h('option', { value: k, selected: k === st.metRegion }, v)))));

    if (!wc) {
      body.append(h('div', { class: 'note' }, 'No forecast cached yet. Click Refresh while online.'));
    } else {
      const d = wc.data;
      const c = d.current || {};
      const age = Math.round((Date.now() - new Date(wc.at)) / 3600000);
      body.append(h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'v' }, (c.temperature_2m ?? '') + '°C'), h('div', { class: 'l' }, `Now: ${WMO[c.weather_code] || ''}, feels ${c.apparent_temperature}°C`)),
        h('div', { class: 'stat ' + (c.wind_gusts_10m > 50 ? 'bad' : c.wind_gusts_10m > 35 ? 'warn' : '') }, h('div', { class: 'v' }, Math.round(c.wind_gusts_10m ?? 0) + ' mph'), h('div', { class: 'l' }, `Gusts (wind ${Math.round(c.wind_speed_10m ?? 0)} mph)`)),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, (c.precipitation ?? 0) + ' mm'), h('div', { class: 'l' }, 'Precipitation now')),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, Math.round(c.pressure_msl ?? 0)), h('div', { class: 'l' }, 'Pressure hPa')),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, (c.relative_humidity_2m ?? '') + '%'), h('div', { class: 'l' }, 'Humidity')),
        h('div', { class: 'stat ' + (age > 12 ? 'warn' : '') }, h('div', { class: 'v' }, age + ' h'), h('div', { class: 'l' }, 'Forecast age (fetched ' + fmtDate(wc.at, true) + ')'))));

      const tempEl = h('div', { class: 'chartbox', style: 'height:220px' });
      const windEl = h('div', { class: 'chartbox', style: 'height:220px' });
      body.append(h('div', { class: 'grid g2' }, panel('Temperature and rain (7 days, hourly)', tempEl), panel('Wind speed and gusts (mph)', windEl)));
      const hr = d.hourly;
      const labels = hr.time.map((t) => { const x = new Date(t); return x.getHours() === 0 ? x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }) : x.getHours() + ':00'; });
      charts.push(chart(tempEl, {
        data: { labels, datasets: [
          { type: 'line', label: 'Temp °C', data: hr.temperature_2m, borderColor: COLORS.red, pointRadius: 0, borderWidth: 1.5, yAxisID: 'y' },
          { type: 'line', label: 'Feels like °C', data: hr.apparent_temperature, borderColor: COLORS.amber, pointRadius: 0, borderWidth: 1, borderDash: [3, 3], yAxisID: 'y' },
          { type: 'bar', label: 'Rain mm', data: hr.precipitation, backgroundColor: COLORS.blue, yAxisID: 'y2' },
        ] },
        options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 14, maxRotation: 0 } }, y: { title: { display: true, text: '°C' } }, y2: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'mm' } } } },
      }));
      charts.push(chart(windEl, {
        type: 'line',
        data: { labels, datasets: [
          { label: 'Wind', data: hr.wind_speed_10m, borderColor: COLORS.teal, pointRadius: 0, borderWidth: 1.5 },
          { label: 'Gusts', data: hr.wind_gusts_10m, borderColor: COLORS.purple, pointRadius: 0, borderWidth: 1, fill: false },
        ] },
        options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 14, maxRotation: 0 } }, y: { beginAtZero: true } } },
      }));

      const dl = d.daily;
      body.append(panel('Daily forecast', table([
        { label: 'Day', get: (i) => fmtDate(dl.time[i]) + ' ' + new Date(dl.time[i]).toLocaleDateString('en-GB', { weekday: 'short' }) },
        { label: 'Conditions', get: (i) => WMO[dl.weather_code[i]] || dl.weather_code[i] },
        { label: 'Max °C', num: true, get: (i) => dl.temperature_2m_max[i] },
        { label: 'Min °C', num: true, get: (i) => h('span', { style: dl.temperature_2m_min[i] <= 0 ? 'color:var(--accent);font-weight:600' : '' }, dl.temperature_2m_min[i]) },
        { label: 'Rain mm', num: true, get: (i) => dl.precipitation_sum[i] },
        { label: 'Rain %', num: true, get: (i) => dl.precipitation_probability_max[i] },
        { label: 'Wind mph', num: true, get: (i) => Math.round(dl.wind_speed_10m_max[i]) },
        { label: 'Gusts mph', num: true, get: (i) => h('span', { style: dl.wind_gusts_10m_max[i] > 50 ? 'color:var(--red);font-weight:600' : dl.wind_gusts_10m_max[i] > 40 ? 'color:var(--amber);font-weight:600' : '' }, Math.round(dl.wind_gusts_10m_max[i])) },
        { label: 'UV', num: true, get: (i) => dl.uv_index_max[i] },
        { label: 'Sunrise', get: (i) => dl.sunrise[i].slice(11) },
        { label: 'Sunset', get: (i) => dl.sunset[i].slice(11) },
      ], dl.time.map((_, i) => i))));
    }

    body.append(panel('Flood warnings within 25 km (England only, Environment Agency)' + (flood ? `  (fetched ${fmtDate(flood.at, true)})` : ''),
      !flood ? h('div', { class: 'muted' }, 'Not fetched yet. In Wales use Natural Resources Wales (add their flood page to the Library) or Floodline 0345 988 1188.')
        : table([
          { label: 'Severity', get: (r) => h('b', { style: r.level <= 2 ? 'color:var(--red)' : 'color:var(--amber)' }, r.severity) },
          { label: 'Area', key: 'area' }, { label: 'Description', key: 'desc' }, { label: 'Updated', get: (r) => fmtDate(r.changed, true) },
        ], flood.items, { emptyText: 'No flood alerts or warnings in force nearby' })));
    body.append(h('div', { class: 'note' }, 'Forecast: Open-Meteo (free, non-commercial). Warnings: Met Office RSS. Flood: Environment Agency real-time API. The last fetched data stays available offline.'));
  };

  const refresh = async (what = ['wx', 'warn', 'flood']) => {
    if (st.offlineMode || !navigator.onLine) return status('Offline: showing last saved data');
    status('Fetching...', 0);
    const errs = [];
    if (what.includes('wx') && hh.lat) await fetchForecast(hh.lat, hh.lon).catch((e) => errs.push('forecast: ' + e.message));
    if (what.includes('warn')) await fetchWarnings(st.metRegion).catch((e) => errs.push('warnings: ' + e.message));
    if (what.includes('flood') && hh.lat) await fetchFloods(hh.lat, hh.lon).catch((e) => errs.push('floods: ' + e.message));
    status(errs.length ? 'Some updates failed: ' + errs.join('; ') : 'Weather updated', 8000);
    draw();
  };

  root.append(h('div', { class: 'row', style: 'margin-bottom:8px' },
    h('button', { class: 'primary', onclick: () => refresh() }, icon('refresh'), 'Refresh all'),
    h('span', { class: 'muted' }, hh.lat ? `Location: ${hh.postcode || ''} (${hh.lat.toFixed(3)}, ${hh.lon.toFixed(3)})` : 'No location set'),
    h('span', { class: 'spacer' }),
    h('button', { onclick: () => window.api.app.openExternal('https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings') }, icon('open-in-new'), 'Met Office website')), body);
  draw();
  const wc = store.get('weatherCache');
  if (st.autoCheckWeather && navigator.onLine && !st.offlineMode && (!wc || Date.now() - new Date(wc.at) > 3 * 3600000)) refresh();
  return () => charts.forEach((c) => c.destroy());
}
