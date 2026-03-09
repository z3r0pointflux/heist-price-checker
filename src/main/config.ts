import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface AppConfig {
  hotkey: string;
  league: string;
  overlayDismissMs: number;
  autoDismiss: boolean;
  overlayPosition: 'cursor' | 'left';
}

const DEFAULT_CONFIG: AppConfig = {
  hotkey: 'Ctrl+Shift+D',
  league: 'Standard',
  overlayDismissMs: 5000,
  autoDismiss: true,
  overlayPosition: 'cursor',
};

let currentConfig: AppConfig = { ...DEFAULT_CONFIG };

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

export function loadConfig(): AppConfig {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const loaded = JSON.parse(data);
      currentConfig = { ...DEFAULT_CONFIG, ...loaded };
    } else {
      currentConfig = { ...DEFAULT_CONFIG };
      saveConfig(currentConfig);
    }
  } catch {
    currentConfig = { ...DEFAULT_CONFIG };
  }
  return currentConfig;
}

export function saveConfig(config: AppConfig): void {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  currentConfig = { ...config };
}

export function getConfig(): AppConfig {
  return currentConfig;
}
