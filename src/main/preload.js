const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('api', {
  store: { all: inv('store:all'), set: inv('store:set') },
  net: { get: inv('net:get') },
  webcache: {
    add: inv('webcache:add'),
    update: inv('webcache:update'),
    remove: inv('webcache:remove'),
    capture: inv('webcache:capture'),
    cancel: inv('webcache:cancel'),
    stats: inv('webcache:stats'),
    fileUrl: inv('webcache:fileUrl'),
    openFolder: inv('webcache:openFolder'),
  },
  tiles: {
    sources: inv('tiles:sources'),
    estimate: inv('tiles:estimate'),
    download: inv('tiles:download'),
    cancel: inv('tiles:cancel'),
    stats: inv('tiles:stats'),
    clear: inv('tiles:clear'),
  },
  vault: Object.fromEntries(['status', 'create', 'unlock', 'lock', 'changePassword', 'list', 'saveEntry', 'removeEntry', 'addFiles', 'pickFiles', 'removeFile', 'saveCopy', 'openExternal', 'stats', 'backup', 'restore', 'destroy'].map((m) => [m, inv('vault:' + m)])),
  usb: Object.fromEntries(['drives', 'estimate', 'chooseFolder', 'run', 'restore', 'cancel', 'eject', 'openFolder', 'preview', 'apply', 'syncStatus', 'present'].map((m) => [m, inv('usb:' + m)])),
  print: { html: inv('print:html') },
  backup: { export: inv('backup:export'), import: inv('backup:import') },
  app: { openDataFolder: inv('app:openDataFolder'), openExternal: inv('app:openExternal'), info: inv('app:info') },
  on: (ch, fn) => {
    const allowed = ['store:changed', 'webcache:progress', 'tiles:progress', 'nav', 'viewer:open-request', 'vault:changed', 'backup:progress', 'usb:sync-status', 'usb:present'];
    if (!allowed.includes(ch)) throw new Error('channel not allowed');
    const h = (_e, p) => fn(p);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  },
});
