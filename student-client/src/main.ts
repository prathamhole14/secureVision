// @ts-ignore
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';

let mainWindow: any = null;
let daemonProcess: any = null;
let daemonSocket: any = null;

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const DAEMON_SOCKET_PATH = process.platform === 'win32'
  ? '\\\\.\\pipe\\anticheat_daemon'
  : '/tmp/anticheat_daemon.sock';

// --- Daemon IPC ---
let reconnectDelay = 2000;
function connectToDaemon() {
  daemonSocket = net.createConnection(DAEMON_SOCKET_PATH, () => {
    console.log('[Daemon] Connected to security daemon');
    reconnectDelay = 2000; // Reset on success
    mainWindow?.webContents.send('daemon:status', { connected: true });
  });

  daemonSocket.on('data', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('[Daemon] Event:', msg);
      mainWindow?.webContents.send('daemon:event', msg);
    } catch { /* ignore malformed */ }
  });

  daemonSocket.on('close', () => {
    // Check dev mode to suppress verbose connection loss spam
    if (process.env.NODE_ENV === 'production' || reconnectDelay < 10000) {
      console.log(`[Daemon] Socket closed, attempting reconnect in ${reconnectDelay}ms...`);
    }
    mainWindow?.webContents.send('daemon:status', { connected: false });
    setTimeout(connectToDaemon, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 30000); // Exponential backoff up to 30s
  });

  daemonSocket.on('error', (err: any) => {
    if (process.env.NODE_ENV !== 'production' && err.code === 'ENOENT') {
      // Suppress missing daemon socket spam in dev mode
      // This is expected if the daemon isn't running yet or failed to start
      // We still want to attempt reconnecting with backoff.
    } else {
      console.warn('[Daemon] Socket error:', err.message);
    }
    // Attempt reconnect with exponential backoff on any error
    if (process.env.NODE_ENV === 'production' || reconnectDelay < 10000) {
      console.log(`[Daemon] Socket error, attempting reconnect in ${reconnectDelay}ms...`);
    }
    mainWindow?.webContents.send('daemon:status', { connected: false });
    setTimeout(connectToDaemon, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 30000); // Exponential backoff up to 30s
  });
}

function launchDaemon() {
  const daemonBinary = process.platform === 'win32' ? 'anticheat-daemon.exe' : 'anticheat-daemon';
  const daemonPath = path.join(__dirname, '..', 'daemon', daemonBinary);
  try {
    daemonProcess = spawn(daemonPath, [], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    daemonProcess.stdout?.on('data', (d: any) => console.log('[Daemon stdout]', d.toString()));
    daemonProcess.stderr?.on('data', (d: any) => console.error('[Daemon stderr]', d.toString()));

    daemonProcess.on('error', (err: any) => {
      console.warn(`[Daemon] Failed to start daemon process: ${err.message}. Ensure it is compiled and placed at ${daemonPath}.`);
      daemonProcess = null;
    });

    daemonProcess.on('exit', (code: any) => {
      console.log(`[Daemon] Exited with code ${code}`);
      daemonProcess = null;
    });

    // Wait a moment for daemon to start listening before connecting
    setTimeout(connectToDaemon, 1000);
  } catch (err) {
    console.warn('[Daemon] Could not launch daemon binary (expected in dev mode):', (err as Error).message);
    // Still try to connect in case daemon is running externally
    setTimeout(connectToDaemon, 500);
  }
}

function sendToDaemon(message: object) {
  if (daemonSocket?.writable) {
    daemonSocket.write(JSON.stringify(message) + '\n');
  }
}

// --- Electron Window ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    // Exam client should ideally be fullscreen in dev too for testing the experience,
    // but at the very least we should allow it to be maximized when requested.
    fullscreen: true,
    kiosk: true,
    resizable: false,
    frame: false,
    alwaysOnTop: process.env.NODE_ENV === 'production',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,       // Security: isolate renderer from Node.js
      nodeIntegration: false,        // Security: no Node.js in renderer
      sandbox: false,                // Disable sandbox so preload can use contextBridge
      devTools: true,
      webSecurity: process.env.NODE_ENV === 'production', // Relax in dev for cross-origin backend resources
      allowRunningInsecureContent: false,
    },
  });

  // Prevent new windows from opening
  mainWindow?.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Prevent navigation away from the app
  mainWindow?.webContents.on('will-navigate', (event: any, url: string) => {
    if (!url.startsWith(BACKEND_URL) && !url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  // Intercept standard developer and reload shortcut keys at Electron layer
  mainWindow?.webContents.on('before-input-event', (event: any, input: any) => {
    const isControlOrCmd = input.control || input.meta;
    const key = input.key.toLowerCase();
    
    const blockedShortcuts = [
      key === 'f5',
      key === 'r' && isControlOrCmd,
      key === 'f12',
      key === 'i' && isControlOrCmd && input.shift,
      key === 'f11',
    ];

    if (blockedShortcuts.some(Boolean)) {
      event.preventDefault();
      console.log(`[Security] Blocked shortcut key in kiosk mode: ${input.key}`);
    }
  });

  // Main process level focus loss tracking as bulletproof fallback
  mainWindow?.on('blur', () => {
    mainWindow?.webContents.send('daemon:event', {
      type: 'focus_loss',
      severity: 'LOW',
      timestamp: new Date().toISOString(),
      payload: { source: 'electron_main' }
    });
  });

  const indexPath = path.join(__dirname, '..', 'src', 'ui', 'index.html');
  mainWindow?.loadFile(indexPath);

  // Removed DevTools auto-open as it breaks fullscreen/kiosk mode
  // mainWindow?.webContents.openDevTools();

  mainWindow?.on('closed', () => { mainWindow = null; });
}

// --- IPC Handlers ---
ipcMain.handle('daemon:start-protection', async (_event: any, sessionKey: string) => {
  if (mainWindow) {
    mainWindow.setContentProtection(true); // DRM active: prevents screenshotting & capture
    console.log('[DRM] Content protection active.');
  }
  sendToDaemon({ command: 'start_protection', sessionKey });
  return { ok: true };
});

ipcMain.handle('daemon:stop-protection', async () => {
  if (mainWindow) {
    mainWindow.setContentProtection(false);
    console.log('[DRM] Content protection disabled.');
  }
  sendToDaemon({ command: 'stop_protection' });
  return { ok: true };
});

ipcMain.handle('daemon:get-status', async () => {
  sendToDaemon({ command: 'get_status' });
  return { ok: true };
});

ipcMain.handle('app:get-backend-url', () => BACKEND_URL);

ipcMain.handle('app:request-fullscreen', async () => {
  if (mainWindow) {
    mainWindow.maximize();
    mainWindow.setFullScreen(true);
    // Optional: force it to the top
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }
  return { ok: true };
});

ipcMain.handle('app:close', async () => {
  setTimeout(() => {
    if (daemonProcess) {
      daemonProcess.kill();
    }
    app.exit(0);
  }, 100);
  return { ok: true };
});

// Soft JS-level blur detection reported to daemon bridge
ipcMain.on('renderer:focus-event', (_event: any, data: any) => {
  mainWindow?.webContents.send('daemon:event', {
    type: data.type === 'blur' ? 'focus_loss' : 'focus_regained',
    severity: 'LOW',
    timestamp: new Date().toISOString(),
    payload: data,
  });
});

function createApplicationMenu() {
  const template = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template as any);
  Menu.setApplicationMenu(menu);
}

// --- App lifecycle ---
app.whenReady().then(() => {
  // In dev mode, allow loading cross-origin resources (backend socket.io.js etc.)
  if (process.env.NODE_ENV !== 'production') {
    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
  }

  createWindow();
  createApplicationMenu();
  launchDaemon();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  sendToDaemon({ command: 'stop_protection' });
  daemonProcess?.kill();
  if (process.platform !== 'darwin') app.quit();
});

// Prevent multiple instances
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
