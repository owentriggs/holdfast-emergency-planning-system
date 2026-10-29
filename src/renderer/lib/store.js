// Renderer-side store: in-memory copy of every key, saved to disk via the main process with a short debounce.
import { DEFAULTS } from '../data/defaults.js';

const cache = {};
const timers = {};
const listeners = new Set();

export async function init() {
  Object.assign(cache, await window.api.store.all());
  window.api.on('store:changed', ({ key, value }) => {
    cache[key] = value;
    listeners.forEach((fn) => fn(key));
  });
}

export function get(key) {
  if (cache[key] === undefined) {
    cache[key] = structuredClone(DEFAULTS[key] ?? null);
    if (key !== 'webcache' && cache[key] !== null) save(key);
  }
  return cache[key];
}

export function set(key, value) {
  cache[key] = value;
  save(key);
}

export function save(key) {
  if (key === 'webcache') return;
  const el = document.getElementById('savestate');
  if (el) el.textContent = 'Saving...';
  clearTimeout(timers[key]);
  timers[key] = setTimeout(async () => {
    try {
      await window.api.store.set(key, cache[key]);
      if (el) el.textContent = 'Saved ' + new Date().toLocaleTimeString('en-GB');
    } catch (e) {
      if (el) el.textContent = 'SAVE FAILED: ' + e.message;
    }
  }, 350);
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function settings() {
  return get('settings');
}

export function householdSize() {
  const hh = get('household');
  return Math.max(1, (hh.people || []).length);
}
