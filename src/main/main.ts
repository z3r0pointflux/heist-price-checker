import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  Tray,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { loadConfig, saveConfig, getConfig, AppConfig } from './config';
import { takeScreenshot } from './screenshot';
import { detectHighlight } from './highlight';
import { initOCR, recognizeText, shutdownOCR } from './ocr';
import { classifyItem } from './itemDetect';
import {
  ensureFreshCache,
  fetchAvailableLeagues,
  fetchPriceData,
  getPriceDataStatus,
  hasPriceData,
  lookupPriceRange,
  startPeriodicRefresh,
  STACKABLE_TYPES_LIST,
  stopPeriodicRefresh,
  variantLabel,
} from './pricing';

let tray: Tray | null = null;
let overlayWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let isProcessing = false;

// The renderer only starts listening once its script has run. Sending before
// that drops the payload silently and leaves the overlay showing nothing, so
// hold the most recent result until the renderer says it is listening.
let overlayReady = false;
let pendingOverlayData: any = null;
// A single shared dismiss timer: stacking one per check meant an earlier timer
// could hide a newer overlay seconds after it appeared.
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

// --- File logging ---
const logPath = path.join(
  app.getPath('userData'),
  'heistchecker.log'
);

function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(logPath, line + '\n');
  } catch {}
}

function logError(message: string, err?: any): void {
  const errStr = err instanceof Error ? err.stack || err.message : String(err ?? '');
  const line = `[${new Date().toISOString()}] ERROR: ${message} ${errStr}`;
  console.error(line);
  try {
    fs.appendFileSync(logPath, line + '\n');
  } catch {}
}

function getAssetPath(filename: string): string {
  // app.getAppPath() returns project root in dev, app.asar in packaged
  return path.join(app.getAppPath(), 'assets', filename);
}

function getPreloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

function getIconPath(): string {
  // In packaged app, assets is at resources/app/assets; in dev, it's at project root
  const devPath = path.join(__dirname, '..', '..', 'assets', 'icon.ico');
  return devPath;
}

function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 350,
    x: -9999,
    y: -9999,
    show: false,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    icon: getIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayReady = false;
  win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  win.setIgnoreMouseEvents(false);

  return win;
}

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 450,
    // Tall enough for the whole form: at 500 the last field and the Save button
    // pushed past the bottom and the window grew a scrollbar it cannot scroll
    // usefully, since it is not resizable.
    height: 566,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: "z3r0's Heist Price Checker - Settings",
    icon: getIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.setMenu(null);
  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// A tray context menu is drawn by Windows, so it takes no styling from the app.
// What it can do is stop being three bare verbs: the two things worth knowing
// without opening Settings are which league prices come from and what the
// hotkey is, so both are shown inline as disabled rows.
function priceStatusLabel(): string {
  const status = getPriceDataStatus();
  switch (status.state) {
    case 'ok':
      return `${status.itemCount.toLocaleString()} items loaded`;
    case 'empty':
      return 'no data returned';
    case 'league-retired':
      return status.switchedTo ? `switched to ${status.switchedTo}` : 'league retired';
    case 'league-unknown':
      return `unknown league "${status.league}"`;
    case 'network-error':
      return 'offline';
    case 'never-fetched':
      return 'loading…';
  }
}

function refreshTrayMenu(): void {
  if (!tray) return;

  const config = getConfig();

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `League: ${config.league}`, enabled: false },
    { label: `Prices: ${priceStatusLabel()}`, enabled: false },
    { type: 'separator' },
    { label: `Price check\t${config.hotkey}`, enabled: false },
    { type: 'separator' },
    { label: 'Settings…', click: () => createSettingsWindow() },
    {
      label: 'Refresh prices now',
      click: async () => {
        await fetchPriceData();
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

function createTray(): void {
  // Use .ico on Windows for proper tray icon display, .png elsewhere
  const iconFile = process.platform === 'win32' ? 'tray-icon.ico' : 'tray-icon.png';
  const iconPath = getAssetPath(iconFile);
  log(`Creating tray with icon: ${iconPath}`);

  try {
    tray = new Tray(iconPath);
  } catch (err) {
    // Fallback to .png if .ico fails
    logError('Failed to create tray with .ico, falling back to .png', err);
    tray = new Tray(getAssetPath('tray-icon.png'));
  }

  tray.setToolTip("z3r0's Heist Price Checker");
  refreshTrayMenu();

  // Left-click opens settings
  tray.on('click', () => {
    createSettingsWindow();
  });
}

function registerHotkey(): void {
  const config = getConfig();
  globalShortcut.unregisterAll();

  const registered = globalShortcut.register(config.hotkey, () => {
    handleHotkeyPress();
  });

  if (!registered) {
    logError(`Failed to register hotkey: ${config.hotkey}`);
  } else {
    log(`Hotkey registered: ${config.hotkey}`);
  }
}

async function handleHotkeyPress(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // 1. Get cursor position
    const cursorPos = screen.getCursorScreenPoint();
    log(`Hotkey pressed, cursor at (${cursorPos.x}, ${cursorPos.y})`);

    // 2. Take screenshot
    const screenshotBuf = await takeScreenshot();
    log(`Screenshot captured (${screenshotBuf.length} bytes)`);

    // 3. Detect highlight region
    const highlight = await detectHighlight(screenshotBuf, cursorPos);
    if (!highlight) {
      log('No highlight region detected');
      showOverlayWithError('No highlighted item detected');
      return;
    }
    const { region, nameBox } = highlight;
    log(`Region (${region.x}, ${region.y}) ${region.width}x${region.height}` +
        `${nameBox ? `, name box y ${nameBox.y} h ${nameBox.height}` : ', no name box'}`);

    // 4. OCR the region
    const { lines, nameLines } = await recognizeText(screenshotBuf, region, nameBox);
    if (lines.length === 0) {
      log('OCR returned no text');
      showOverlayWithError('Could not read item text');
      return;
    }
    log(`OCR name lines: ${JSON.stringify(nameLines)} | all: ${JSON.stringify(lines)}`);

    // 5. Classify item & look up price
    const itemInfo = classifyItem(lines, nameLines);
    log(`Item: ${JSON.stringify(itemInfo)}`);

    await ensureFreshCache();

    // Without price data every lookup returns null, which used to render as an
    // item name and a blank price — indistinguishable from "this item is worth
    // nothing". Say what actually went wrong instead.
    if (!hasPriceData()) {
      const status = getPriceDataStatus();
      log(`No price data available: ${JSON.stringify(status)}`);
      showOverlayWithError(describePriceDataFailure(status));
      return;
    }

    // Look up price range for the item
    let range: ReturnType<typeof lookupPriceRange> = null;
    if (itemInfo.type === 'rare') {
      range = lookupPriceRange(itemInfo.searchTerm, 'BaseType');
    } else if (itemInfo.type === 'currency') {
      // "currency" here means any stackable, which now covers scarabs, essences,
      // fossils and the rest of the exchange categories. Trying only Currency
      // and Fragment meant a scarab could be detected and cached and still
      // price as null, because its itemType matched neither.
      for (const cat of STACKABLE_TYPES_LIST) {
        range = lookupPriceRange(itemInfo.searchTerm, cat);
        if (range) break;
      }
    } else {
      // Unique — try each unique category
      for (const cat of ['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel']) {
        range = lookupPriceRange(itemInfo.searchTerm, cat);
        if (range) break;
      }
    }
    log(`lookupPriceRange("${itemInfo.searchTerm}", ${itemInfo.type}) => ${range ? `${range.name}: lowest ${range.minChaos}c of ${range.entries.length} variants (max ${range.maxChaos}c)` : 'null'}`);

    // 6. Show overlay
    showOverlay({
      itemInfo,
      price: range ? {
        name: range.name,
        minChaos: range.minChaos,
        maxChaos: range.maxChaos,
        lowestListings: range.lowestListings,
        lowestLabel: range.lowestLabel ?? null,
        variantCount: range.entries.length,
        icon: range.icon,
        totalListings: range.entries.reduce((sum, e) => sum + e.listingCount, 0),
        variants: range.entries.map(e => ({
          label: variantLabel(e) || null,
          chaos: e.chaosValue,
          listings: e.listingCount,
        })),
      } : null,
      position: {
        // Anchor beside the name box when we found one — that is the tooltip's
        // real position, rather than wherever the search window happened to sit.
        x: (nameBox ?? region).x + (nameBox ?? region).width + 10,
        y: (nameBox ?? region).y,
      },
    });
  } catch (err) {
    logError('Error during price check:', err);
    showOverlayWithError('Error during price check');
  } finally {
    isProcessing = false;
  }
}

function showOverlay(data: any): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createOverlayWindow();
  }

  // Position the overlay near the detected item
  const { x, y } = data.position;
  const display = screen.getDisplayNearestPoint({ x, y });
  const bounds = display.bounds;

  // Keep overlay within screen bounds
  let posX = Math.min(x, bounds.x + bounds.width - 320);
  let posY = Math.min(y, bounds.y + bounds.height - 350);
  posX = Math.max(posX, bounds.x);
  posY = Math.max(posY, bounds.y);

  overlayWindow.setPosition(Math.round(posX), Math.round(posY));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.showInactive();
  log(`Overlay shown at (${Math.round(posX)}, ${Math.round(posY)}), price: ${data.price ? data.price.name + ' ' + data.price.minChaos + 'c' : 'none'}`);

  // Deliver now if the renderer is listening, otherwise let 'overlay-ready' flush it.
  if (overlayReady) {
    overlayWindow.webContents.send('price-result', data);
  } else {
    pendingOverlayData = data;
  }

  // Auto-dismiss — replace any timer from a previous check.
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  const config = getConfig();
  if (config.autoDismiss) {
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide();
      }
    }, config.overlayDismissMs);
  }
}

function describePriceDataFailure(status: ReturnType<typeof getPriceDataStatus>): string {
  switch (status.state) {
    case 'network-error':
      return 'Could not reach poe.ninja';
    case 'league-retired':
      return status.switchedTo
        ? `"${status.league}" has ended — switched to ${status.switchedTo}, retry`
        : `League "${status.league}" has ended — pick a new one in Settings`;
    case 'league-unknown':
      return `poe.ninja has no data for "${status.league}" — check Settings`;
    case 'empty':
      return `No price data for ${status.league}`;
    default:
      return 'Price data unavailable';
  }
}

function showOverlayWithError(message: string): void {
  showOverlay({
    itemInfo: { type: 'currency', searchTerm: '', displayName: message },
    price: null,
    position: {
      x: screen.getCursorScreenPoint().x + 20,
      y: screen.getCursorScreenPoint().y,
    },
  });
}

// IPC Handlers
ipcMain.on('open-external', (_event, url: string) => {
  const { shell } = require('electron');
  // Only allow known safe URLs
  if (url.startsWith('https://ko-fi.com/') || url.startsWith('https://discord.gg/')) {
    shell.openExternal(url);
  }
});

ipcMain.on('overlay-ready', () => {
  overlayReady = true;
  if (pendingOverlayData && overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('price-result', pendingOverlayData);
    pendingOverlayData = null;
  }
});

ipcMain.on('dismiss-overlay', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
});

ipcMain.handle('get-config', () => {
  return getConfig();
});

ipcMain.handle('save-config', async (_event, newConfig: AppConfig) => {
  const oldLeague = getConfig().league;
  saveConfig(newConfig);
  registerHotkey();

  // Refresh prices if league changed
  if (newConfig.league !== oldLeague) {
    log(`League changed from "${oldLeague}" to "${newConfig.league}", refreshing prices...`);
    await fetchPriceData();
  }

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('config-saved');
  }

  // The tray menu shows league and hotkey, so it goes stale unless rebuilt here.
  refreshTrayMenu();
  return true;
});

ipcMain.handle('get-leagues', async () => {
  // Source the list from poe.ninja rather than the PoE API: these are the leagues
  // we can actually price. The PoE API also lists SSF/Ruthless leagues that have
  // no economy data, which just produce an empty overlay.
  try {
    const leagues = await fetchAvailableLeagues();
    if (leagues.length > 0) return leagues;
  } catch (err) {
    logError('Could not fetch leagues from poe.ninja:', err);
  }

  // Fallback: the PoE league API, filtered to leagues with a tradeable economy.
  try {
    const response = await fetch('https://api.pathofexile.com/leagues?type=main&compact=1', {
      headers: { 'User-Agent': 'HeistChecker/1.2' },
    });
    if (response.ok) {
      const leagues = await response.json();
      return leagues
        .map((l: any) => l.id)
        .filter((id: string) => !/SSF|Ruthless|Solo Self-Found/i.test(id));
    }
  } catch {}

  // Last resort. Only reached if the machine is offline.
  return ['Standard', 'Hardcore'];
});

// App lifecycle
app.whenReady().then(async () => {
  log('App starting...');
  log(`App path: ${app.getAppPath()}`);
  log(`User data: ${app.getPath('userData')}`);
  log(`Is packaged: ${app.isPackaged}`);
  log(`Log file: ${logPath}`);

  loadConfig();
  createTray();
  registerHotkey();

  // Pre-create overlay window
  overlayWindow = createOverlayWindow();

  // Initialize OCR engine in background
  log('Initializing OCR...');
  initOCR().then(() => log('OCR ready'));

  // Fetch price data
  log('Fetching price data...');
  fetchPriceData()
    .then(() => {
      log('Price data ready');
      refreshTrayMenu();
    })
    .catch(err => {
      logError('Price data fetch failed:', err);
      refreshTrayMenu();
    });

  startPeriodicRefresh();
  log('App ready');
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopPeriodicRefresh();
  shutdownOCR();
});

// Prevent app from quitting when all windows are closed (tray app)
app.on('window-all-closed', (e: Event) => {
  e.preventDefault();
});
