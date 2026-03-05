interface HeistAPI {
  openExternal: (url: string) => void;
  onPriceResult: (callback: (data: any) => void) => void;
  dismissOverlay: () => void;
  getConfig: () => Promise<any>;
  saveConfig: (config: any) => Promise<boolean>;
  getLeagues: () => Promise<string[]>;
  onConfigSaved: (callback: () => void) => void;
}

interface Window {
  heistAPI: HeistAPI;
}
