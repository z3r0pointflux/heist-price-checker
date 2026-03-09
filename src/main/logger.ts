import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { screen } from 'electron';
import type { AppConfig } from './config';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
  level: LogLevel;
  source: string;
  message: string;
  stack?: string;
  data?: object;
}

let logPath: string | null = null;

export function getLogPath(): string {
  if (logPath) return logPath;
  logPath = path.join(app.getPath('userData'), 'logs', 'main.log');
  return logPath;
}

function ensureLogDir(): void {
  try {
    const dir = path.dirname(getLogPath());
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

function formatLine(entry: LogEntry): string {
  const ts = new Date().toISOString();
  const level = entry.level.padEnd(5);
  const dataStr = entry.data != null ? ' ' + JSON.stringify(entry.data) : '';
  const first = `[${ts}] ${level} ${entry.source.padEnd(18)} ${entry.message}${dataStr}\n`;
  if (entry.stack) {
    const stackLines = entry.stack.split('\n').map((l) => '\t' + l).join('\n');
    return first + stackLines + '\n';
  }
  return first;
}

function writeEntry(entry: LogEntry): void {
  try {
    ensureLogDir();
    fs.appendFileSync(getLogPath(), formatLine(entry), 'utf-8');
  } catch {
    // avoid throwing from logger
  }
}

export function log(
  level: LogLevel,
  source: string,
  message: string,
  options?: { stack?: string; data?: object }
): void {
  writeEntry({
    level,
    source,
    message,
    stack: options?.stack,
    data: options?.data,
  });
}

export function info(source: string, message: string, data?: object): void {
  log('INFO', source, message, data != null ? { data } : undefined);
}

export function warn(source: string, message: string, data?: object): void {
  log('WARN', source, message, data != null ? { data } : undefined);
}

export function error(source: string, message: string, options?: { stack?: string; data?: object }): void {
  log('ERROR', source, message, options);
}

export function logSessionStart(): void {
  const primary = screen.getPrimaryDisplay();
  const bounds = primary.bounds;
  const displayCount = screen.getAllDisplays().length;
  info('main', 'App started', {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    release: os.release(),
    displayBounds: { width: bounds.width, height: bounds.height },
    displayCount,
  });
}

export function logConfig(config: AppConfig): void {
  info('main', 'Config loaded', {
    league: config.league,
    overlayPosition: config.overlayPosition,
    hotkey: config.hotkey,
    autoDismiss: config.autoDismiss,
    overlayDismissMs: config.overlayDismissMs,
  });
}
