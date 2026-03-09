import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('heistAPI', {
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  onPriceResult: (callback: (data: any) => void) => {
    ipcRenderer.on('price-result', (_event, data) => callback(data));
  },
  onAppendPriceResult: (callback: (data: any) => void) => {
    ipcRenderer.on('append-price-result', (_event, data) => callback(data));
  },
  dismissOverlay: () => {
    ipcRenderer.send('dismiss-overlay');
  },
  // Settings
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config: any) => ipcRenderer.invoke('save-config', config),
  getLeagues: () => ipcRenderer.invoke('get-leagues'),
  onConfigSaved: (callback: () => void) => {
    ipcRenderer.on('config-saved', () => callback());
  },
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
  logToMain: (level: string, source: string, message: string, data?: object) => {
    ipcRenderer.send('renderer-log', { level, source, message, data });
  },
});
