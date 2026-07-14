'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { defaultSessionsPath } = require('./src/token-reader');
const { SnapshotService } = require('./src/snapshot-service');

const DEFAULT_SETTINGS = Object.freeze({
  alwaysOnTop: true,
  launchAtLogin: false,
  minimizeToTray: true,
  displayMode: 'full',
  miniLimits: 'both',
  miniLayout: 'context-focus',
  miniContext: true,
  opacity: 1,
  refreshMs: 5000,
  theme: 'midnight',
  accent: 'mint',
  sourceDir: defaultSessionsPath(),
  windowBounds: null,
});

const DISPLAY_MODES = Object.freeze({
  full: { width: 470, height: 748, minWidth: 360, minHeight: 278 },
  compact: { width: 408, height: 280, minWidth: 360, minHeight: 240 },
  mini: { width: 300, height: 118, minWidth: 280, minHeight: 110 },
});

const EQUAL_MINI_MODE = Object.freeze({ width: 202, height: 118, minWidth: 196, minHeight: 110 });

let mainWindow = null;
let tray = null;
let isQuitting = false;
let saveBoundsTimer = null;
let reader = null;
let settings = { ...DEFAULT_SETTINGS };
const isCaptureRun = process.argv.some((value) => value.startsWith('--capture='));
const hasSingleInstanceLock = isCaptureRun || app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

function configPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const stored = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    const displayMode = stored.displayMode || (stored.compact ? 'compact' : 'full');
    settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored, displayMode });
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  return settings;
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    console.error('Unable to save QuotaHalo settings:', error);
  }
}

function sanitizeSettings(candidate) {
  const sourceDir = typeof candidate.sourceDir === 'string' && candidate.sourceDir.trim()
    ? path.resolve(candidate.sourceDir.trim())
    : defaultSessionsPath();
  const refreshOptions = [2000, 5000, 10000, 30000];
  const themes = ['midnight', 'graphite', 'light'];
  const accents = ['mint', 'violet', 'cyan', 'amber'];
  const displayModes = Object.keys(DISPLAY_MODES);
  const miniLimitModes = ['both', 'primary', 'secondary'];
  const miniLayouts = ['context-focus', 'equal'];
  const opacity = Math.min(1, Math.max(0.65, Number(candidate.opacity) || 1));

  return {
    alwaysOnTop: Boolean(candidate.alwaysOnTop),
    launchAtLogin: Boolean(candidate.launchAtLogin),
    minimizeToTray: candidate.minimizeToTray !== false,
    displayMode: displayModes.includes(candidate.displayMode) ? candidate.displayMode : 'full',
    miniLimits: miniLimitModes.includes(candidate.miniLimits) ? candidate.miniLimits : 'both',
    miniLayout: miniLayouts.includes(candidate.miniLayout) ? candidate.miniLayout : 'context-focus',
    miniContext: candidate.miniContext !== false,
    opacity,
    refreshMs: refreshOptions.includes(Number(candidate.refreshMs)) ? Number(candidate.refreshMs) : 5000,
    theme: themes.includes(candidate.theme) ? candidate.theme : 'midnight',
    accent: accents.includes(candidate.accent) ? candidate.accent : 'mint',
    sourceDir,
    windowBounds: validBounds(candidate.windowBounds) ? candidate.windowBounds : null,
  };
}

function validBounds(bounds) {
  return bounds
    && Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width >= 196
    && bounds.height >= 110;
}

function windowOptions() {
  const mode = displayModePreset(settings.displayMode);
  const stored = settings.windowBounds;
  const restoreCustomSize = settings.displayMode === 'full';

  return {
    width: restoreCustomSize ? stored?.width || mode.width : mode.width,
    height: restoreCustomSize ? stored?.height || mode.height : mode.height,
    x: stored?.x,
    y: stored?.y,
    minWidth: mode.minWidth,
    minHeight: mode.minHeight,
    maxWidth: 860,
    maxHeight: 980,
    frame: false,
    transparent: false,
    hasShadow: true,
    resizable: true,
    show: false,
    alwaysOnTop: settings.alwaysOnTop,
    backgroundColor: '#0b0f14',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: process.argv.includes('--dev'),
      backgroundThrottling: false,
    },
  };
}

function displayModePreset(displayMode) {
  if (displayMode === 'mini' && (settings.miniLayout === 'equal' || !settings.miniContext)) return EQUAL_MINI_MODE;
  return DISPLAY_MODES[displayMode];
}

function iconPath() {
  const png = path.join(__dirname, 'assets', 'icon.png');
  return fs.existsSync(png) ? png : undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow(windowOptions());
  mainWindow.setOpacity(settings.opacity);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const capturePath = commandLineValue('capture');
  if (capturePath) {
    mainWindow.webContents.once('did-finish-load', () => {
      if (process.argv.includes('--open-settings')) {
        mainWindow.webContents.executeJavaScript("document.getElementById('settingsButton')?.click()");
      }
      if (process.argv.includes('--scroll-settings')) {
        mainWindow.webContents.executeJavaScript("setTimeout(() => { const panel = document.querySelector('.settings-scroll'); if (panel) panel.scrollTop = panel.scrollHeight; }, 150)");
      }
      if (process.argv.includes('--restore-check')) {
        setTimeout(() => mainWindow?.minimize(), 900);
        setTimeout(() => {
          mainWindow?.restore();
          mainWindow?.show();
          mainWindow?.focus();
        }, 2200);
      }
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(path.resolve(capturePath), image.toPNG());
        } catch (error) {
          console.error('Unable to capture QuotaHalo frame:', error);
          process.exitCode = 1;
        } finally {
          isQuitting = true;
          app.quit();
        }
      }, 6500);
    });
  }
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && settings.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      refreshTrayMenu();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('QuotaHalo renderer stopped:', details.reason);
    if (!isQuitting && mainWindow) setTimeout(() => mainWindow?.reload(), 350);
  });

  const queueBoundsSave = () => {
    if (!mainWindow || mainWindow.isMaximized() || mainWindow.isMinimized()) return;
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      if (!mainWindow) return;
      settings.windowBounds = mainWindow.getBounds();
      saveSettings();
    }, 350);
  };

  mainWindow.on('move', queueBoundsSave);
  mainWindow.on('resize', queueBoundsSave);
  mainWindow.on('show', () => {
    refreshTrayMenu();
    requestRendererRefresh();
  });
  mainWindow.on('hide', refreshTrayMenu);
  mainWindow.on('restore', requestRendererRefresh);
  mainWindow.on('focus', requestRendererRefresh);
}

function requestRendererRefresh() {
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('quotahalo:refresh');
  }
}

function commandLineValue(name) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : null;
}

function createTray() {
  const imagePath = iconPath();
  let image = imagePath ? nativeImage.createFromPath(imagePath) : nativeImage.createEmpty();
  if (image.isEmpty()) image = nativeImage.createFromDataURL(fallbackIconDataUrl());
  tray = new Tray(image.resize({ width: 18, height: 18 }));
  tray.setToolTip('QuotaHalo — local token and quota monitor');
  tray.on('click', toggleWindow);
  refreshTrayMenu();
}

function fallbackIconDataUrl() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#11151c"/><circle cx="16" cy="16" r="9" fill="none" stroke="#8bffb0" stroke-width="2"/><circle cx="16" cy="16" r="4" fill="none" stroke="#8bffb0" stroke-width="2"/><path d="M16 16 25 7" stroke="#8bffb0" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="16" r="2" fill="#8bffb0"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: mainWindow?.isVisible() ? 'Hide QuotaHalo' : 'Show QuotaHalo',
      click: toggleWindow,
    },
    { type: 'separator' },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: settings.alwaysOnTop,
      click: (item) => updateSettings({ alwaysOnTop: item.checked }),
    },
    {
      label: 'Window size',
      submenu: ['full', 'compact', 'mini'].map((mode) => ({
        label: mode === 'full' ? 'Full' : mode[0].toUpperCase() + mode.slice(1),
        type: 'radio',
        checked: settings.displayMode === mode,
        click: () => setDisplayMode(mode),
      })),
    },
    { type: 'separator' },
    {
      label: 'Refresh now',
      click: () => mainWindow?.webContents.send('quotahalo:refresh'),
    },
    {
      label: 'Quit QuotaHalo',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function toggleWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    requestRendererRefresh();
    return;
  }
  if (mainWindow.isVisible()) mainWindow.hide();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function setDisplayMode(displayMode) {
  if (!DISPLAY_MODES[displayMode]) return;
  settings.displayMode = displayMode;
  saveSettings();
  if (mainWindow) {
    const mode = displayModePreset(displayMode);
    mainWindow.setMinimumSize(mode.minWidth, mode.minHeight);
    mainWindow.setBounds({ ...mainWindow.getBounds(), width: mode.width, height: mode.height }, true);
    mainWindow.webContents.send('quotahalo:settings-changed', publicSettings());
  }
  refreshTrayMenu();
}

function cycleDisplayMode() {
  const modes = ['full', 'compact', 'mini'];
  const index = modes.indexOf(settings.displayMode);
  setDisplayMode(modes[(index + 1) % modes.length]);
}

function publicSettings() {
  return {
    ...settings,
    defaultSourceDir: defaultSessionsPath(),
    appVersion: app.getVersion(),
  };
}

function updateSettings(patch) {
  const oldSource = settings.sourceDir;
  settings = sanitizeSettings({ ...settings, ...patch, windowBounds: settings.windowBounds });
  saveSettings();

  if (reader && oldSource !== settings.sourceDir) {
    reader.setSourceDir(settings.sourceDir).catch((error) => console.error('Unable to change token source:', error));
  }
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(settings.alwaysOnTop);
    mainWindow.setOpacity(settings.opacity);
  }
  app.setLoginItemSettings({
    openAtLogin: settings.launchAtLogin,
    path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
  });
  refreshTrayMenu();
  return publicSettings();
}

function registerIpc() {
  ipcMain.handle('quotahalo:get-settings', () => publicSettings());

  ipcMain.handle('quotahalo:update-settings', (_event, patch) => {
    const displayChanged = Object.hasOwn(patch || {}, 'displayMode') && patch.displayMode !== settings.displayMode;
    const miniLayoutChanged = Object.hasOwn(patch || {}, 'miniLayout') && patch.miniLayout !== settings.miniLayout;
    const miniContextChanged = Object.hasOwn(patch || {}, 'miniContext') && patch.miniContext !== settings.miniContext;
    const updated = updateSettings(patch || {});
    if (displayChanged) setDisplayMode(patch.displayMode);
    else if ((miniLayoutChanged || miniContextChanged) && settings.displayMode === 'mini') setDisplayMode('mini');
    mainWindow?.webContents.send('quotahalo:settings-changed', updated);
    return updated;
  });

  ipcMain.handle('quotahalo:reset-settings', () => {
    const bounds = settings.windowBounds;
    settings = { ...DEFAULT_SETTINGS, windowBounds: bounds };
    reader?.setSourceDir(settings.sourceDir).catch((error) => console.error('Unable to reset token source:', error));
    updateSettings(settings);
    setDisplayMode('full');
    return publicSettings();
  });

  ipcMain.handle('quotahalo:get-snapshot', async (_event, options = {}) => {
    try {
      return await reader.snapshot({
        sessionId: typeof options.sessionId === 'string' ? options.sessionId : null,
        force: Boolean(options.force),
      });
    } catch (error) {
      return {
        status: 'error',
        scannedAt: new Date().toISOString(),
        sourceDir: settings.sourceDir,
        current: null,
        sessions: [],
        summary: { discoveredSessions: 0, visibleSessions: 0, activeSessions: 0, tokensAcrossRecent: 0 },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('quotahalo:choose-source', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Codex sessions folder',
      defaultPath: settings.sourceDir,
      properties: ['openDirectory'],
      buttonLabel: 'Use this folder',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('quotahalo:open-source', () => {
    return shell.openPath(settings.sourceDir);
  });

  ipcMain.handle('quotahalo:window-action', (_event, action) => {
    if (!mainWindow) return null;
    switch (action) {
      case 'minimize':
        mainWindow.minimize();
        break;
      case 'close':
        settings.minimizeToTray ? mainWindow.hide() : mainWindow.close();
        break;
      case 'toggle-pin':
        updateSettings({ alwaysOnTop: !settings.alwaysOnTop });
        mainWindow.webContents.send('quotahalo:settings-changed', publicSettings());
        break;
      case 'cycle-display':
        cycleDisplayMode();
        break;
      case 'expand':
        if (settings.displayMode !== 'full') setDisplayMode('full');
        break;
      default:
        break;
    }
    return publicSettings();
  });
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  requestRendererRefresh();
});

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  app.setAppUserModelId('com.sanoobis.quotahalo');
  loadSettings();
  const requestedMode = commandLineValue('display-mode');
  if (DISPLAY_MODES[requestedMode]) settings.displayMode = requestedMode;
  const requestedMiniLayout = commandLineValue('mini-layout');
  if (['context-focus', 'equal'].includes(requestedMiniLayout)) settings.miniLayout = requestedMiniLayout;
  const requestedMiniContext = commandLineValue('mini-context');
  if (['true', 'false'].includes(requestedMiniContext)) settings.miniContext = requestedMiniContext === 'true';
  reader = new SnapshotService({ sourceDir: settings.sourceDir });
  registerIpc();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (!mainWindow) createWindow();
    else toggleWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  reader?.close().catch((error) => console.error('Unable to stop token worker:', error));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !settings.minimizeToTray) app.quit();
});
