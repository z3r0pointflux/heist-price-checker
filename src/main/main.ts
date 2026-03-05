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
import { loadConfig, saveConfig, getConfig, AppConfig } from './config';
import { takeScreenshot } from './screenshot';
import { detectHighlight } from './highlight';
import { initOCR, recognizeText, shutdownOCR } from './ocr';
import { classifyItem } from './itemDetect';
import {
  ensureFreshCache,
  fetchPriceData,
  lookupPrice,
  lookupPriceRange,
  startPeriodicRefresh,
  stopPeriodicRefresh,
} from './pricing';

let tray: Tray | null = null;
let overlayWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let isProcessing = false;

function getAssetPath(filename: string): string {
  // In development, assets are at project root; in production, in resources
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', filename);
  }
  return path.join(__dirname, '..', '..', 'assets', filename);
}

function getPreloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 200,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  win.setIgnoreMouseEvents(false);
  win.setAlwaysOnTop(true, 'screen-saver');

  return win;
}

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 450,
    height: 500,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: "z3r0's Heist Price Checker - Settings",
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

function createTray(): void {
  tray = new Tray(getAssetPath('tray-icon.png'));
  tray.setToolTip("z3r0's Heist Price Checker");

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Settings', click: () => createSettingsWindow() },
    { label: 'Refresh Prices', click: () => fetchPriceData() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
}

function registerHotkey(): void {
  const config = getConfig();
  globalShortcut.unregisterAll();

  const registered = globalShortcut.register(config.hotkey, () => {
    handleHotkeyPress();
  });

  if (!registered) {
    console.error(`[main] Failed to register hotkey: ${config.hotkey}`);
  } else {
    console.log(`[main] Hotkey registered: ${config.hotkey}`);
  }
}

async function handleHotkeyPress(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // 1. Get cursor position
    const cursorPos = screen.getCursorScreenPoint();
    console.log(`[main] Hotkey pressed, cursor at (${cursorPos.x}, ${cursorPos.y})`);

    // 2. Take screenshot
    const screenshotBuf = await takeScreenshot();
    console.log(`[main] Screenshot captured (${screenshotBuf.length} bytes)`);

    // 3. Detect highlight region
    const highlight = await detectHighlight(screenshotBuf, cursorPos);
    if (!highlight) {
      console.log('[main] No highlight region detected');
      showOverlayWithError('No highlighted item detected');
      return;
    }
    console.log(`[main] Highlight found at (${highlight.x}, ${highlight.y}) ${highlight.width}x${highlight.height}`);

    // 4. OCR the region
    const lines = await recognizeText(screenshotBuf, highlight);
    if (lines.length === 0) {
      console.log('[main] OCR returned no text');
      showOverlayWithError('Could not read item text');
      return;
    }
    console.log(`[main] OCR lines: ${JSON.stringify(lines)}`);

    // 5. Classify item & look up price
    const itemInfo = classifyItem(lines);
    console.log(`[main] Item: ${JSON.stringify(itemInfo)}`);

    await ensureFreshCache();

    // Look up price range for the item
    const itemTypeFilter = itemInfo.type === 'rare' ? 'BaseType'
      : itemInfo.type === 'currency' ? 'Currency'
      : undefined;
    let range = lookupPriceRange(itemInfo.searchTerm, itemTypeFilter);
    // Currency might also be in Fragment category
    if (!range && itemInfo.type === 'currency') {
      range = lookupPriceRange(itemInfo.searchTerm, 'Fragment');
    }
    console.log(`[main] lookupPriceRange("${itemInfo.searchTerm}", ${itemTypeFilter}) => ${range ? `${range.name}: ${range.minChaos}-${range.maxChaos}c (${range.entries.length} variants)` : 'null'}`);

    // 6. Show overlay
    showOverlay({
      itemInfo,
      price: range ? {
        name: range.name,
        minChaos: range.minChaos,
        maxChaos: range.maxChaos,
        variantCount: range.entries.length,
        icon: range.icon,
        totalListings: range.entries.reduce((sum, e) => sum + e.listingCount, 0),
      } : null,
      position: {
        x: highlight.x + highlight.width + 10,
        y: highlight.y,
      },
    });
  } catch (err) {
    console.error('[main] Error during price check:', err);
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
  let posY = Math.min(y, bounds.y + bounds.height - 200);
  posX = Math.max(posX, bounds.x);
  posY = Math.max(posY, bounds.y);

  overlayWindow.setPosition(Math.round(posX), Math.round(posY));
  overlayWindow.showInactive();
  console.log(`[main] Overlay shown at (${Math.round(posX)}, ${Math.round(posY)}), price: ${data.price ? data.price.name + ' ' + data.price.chaosValue + 'c' : 'none'}`);

  // Ensure page is loaded before sending data
  if (overlayWindow.webContents.isLoading()) {
    overlayWindow.webContents.once('did-finish-load', () => {
      overlayWindow!.webContents.send('price-result', data);
    });
  } else {
    overlayWindow.webContents.send('price-result', data);
  }

  // Auto-dismiss
  const config = getConfig();
  if (config.autoDismiss) {
    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide();
      }
    }, config.overlayDismissMs);
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
    console.log(`[main] League changed from "${oldLeague}" to "${newConfig.league}", refreshing prices...`);
    await fetchPriceData();
  }

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('config-saved');
  }
  return true;
});

ipcMain.handle('get-leagues', async () => {
  try {
    const response = await fetch('https://api.pathofexile.com/leagues?type=main&compact=1');
    if (response.ok) {
      const leagues = await response.json();
      return leagues.map((l: any) => l.id);
    }
  } catch {}

  // Fallback: common league names
  return ['Standard', 'Hardcore', 'Solo Self-Found (SSF Standard)', 'Hardcore SSF'];
});

// App lifecycle
app.whenReady().then(async () => {
  loadConfig();
  createTray();
  registerHotkey();

  // Pre-create overlay window
  overlayWindow = createOverlayWindow();

  // Initialize OCR engine in background
  console.log('[main] Initializing OCR...');
  initOCR().then(() => console.log('[main] OCR ready'));

  // Fetch price data
  console.log('[main] Fetching price data...');
  fetchPriceData()
    .then(() => console.log('[main] Price data ready'))
    .catch(err => console.error('[main] Price data fetch failed:', err));

  startPeriodicRefresh();
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
