interface HeistAPI {
  openExternal: (url: string) => void;
  onPriceResult: (callback: (data: any) => void) => void;
  dismissOverlay: () => void;
  onToastUpdate: (callback: (data: any) => void) => void;
  onToastDismiss: (callback: () => void) => void;
  reportToastSize: (width: number, height: number) => void;
  getConfig: () => Promise<any>;
  saveConfig: (config: any) => Promise<boolean>;
  getLeagues: () => Promise<string[]>;
  onConfigSaved: (callback: () => void) => void;
}

interface Window {
  heistAPI: HeistAPI;
}
