import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('heistAPI', {
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  onPriceResult: (callback: (data: any) => void) => {
    ipcRenderer.on('price-result', (_event, data) => callback(data));
    // Tell main the listener is attached so it can flush a result that arrived
    // while this window was still loading.
    ipcRenderer.send('overlay-ready');
  },
  dismissOverlay: () => {
    ipcRenderer.send('dismiss-overlay');
  },
  // Startup toast. Same handshake as the overlay: main holds the payload until
  // the listener is attached, otherwise a send during load is dropped silently.
  onToastUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('toast-update', (_event, data) => callback(data));
    ipcRenderer.send('toast-ready');
  },
  onToastDismiss: (callback: () => void) => {
    ipcRenderer.on('toast-dismiss', () => callback());
  },
  reportToastSize: (width: number, height: number) =>
    ipcRenderer.send('toast-size', { width, height }),
  // Settings
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config: any) => ipcRenderer.invoke('save-config', config),
  getLeagues: () => ipcRenderer.invoke('get-leagues'),
  onConfigSaved: (callback: () => void) => {
    ipcRenderer.on('config-saved', () => callback());
  },
});
