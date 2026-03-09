interface HeistAPI {
  openExternal: (url: string) => void;
  onPriceResult: (callback: (data: any) => void) => void;
  onAppendPriceResult: (callback: (data: any) => void) => void;
  dismissOverlay: () => void;
  getConfig: () => Promise<any>;
  saveConfig: (config: any) => Promise<boolean>;
  getLeagues: () => Promise<{ leagues: string[]; fromApi: boolean }>;
  onConfigSaved: (callback: () => void) => void;
  openLogFolder: () => Promise<unknown>;
  logToMain: (level: string, source: string, message: string, data?: object) => void;
}

interface Window {
  heistAPI: HeistAPI;
}
