"use strict";
const electron = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
let mainWindow = null;
let daemonProcess = null;
let daemonSocket = null;
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
    daemonSocket.on('data', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            console.log('[Daemon] Event:', msg);
            mainWindow?.webContents.send('daemon:event', msg);
        }
        catch { /* ignore malformed */ }
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
    daemonSocket.on('error', (err) => {
        if (process.env.NODE_ENV !== 'production' && err.code === 'ENOENT') {
            // Suppress missing daemon socket spam in dev mode
            return;
        }
        console.warn('[Daemon] Socket error:', err.message);
    });
}
function launchDaemon() {
    const daemonPath = path.join(__dirname, '..', 'daemon', 'anticheat-daemon');
    try {
        daemonProcess = spawn(daemonPath, [], {
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        daemonProcess.stdout?.on('data', (d) => console.log('[Daemon stdout]', d.toString()));
        daemonProcess.stderr?.on('data', (d) => console.error('[Daemon stderr]', d.toString()));
        daemonProcess.on('error', (err) => {
            console.warn(`[Daemon] Failed to start daemon process: ${err.message}. Ensure it is compiled and placed at ${daemonPath}.`);
            daemonProcess = null;
        });
        daemonProcess.on('exit', (code) => {
            console.log(`[Daemon] Exited with code ${code}`);
            daemonProcess = null;
        });
        // Wait a moment for daemon to start listening before connecting
        setTimeout(connectToDaemon, 1000);
    }
    catch (err) {
        console.warn('[Daemon] Could not launch daemon binary (expected in dev mode):', err.message);
        // Still try to connect in case daemon is running externally
        setTimeout(connectToDaemon, 500);
    }
}
function sendToDaemon(message) {
    if (daemonSocket?.writable) {
        daemonSocket.write(JSON.stringify(message) + '\n');
    }
}
// --- Electron Window ---
function createWindow() {
    mainWindow = new electron.BrowserWindow({
        width: 1280,
        height: 800,
        // Kiosk mode in production:
        fullscreen: process.env.NODE_ENV === 'production',
        kiosk: process.env.NODE_ENV === 'production',
        resizable: process.env.NODE_ENV !== 'production',
        frame: process.env.NODE_ENV !== 'production',
        alwaysOnTop: process.env.NODE_ENV === 'production',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, // Security: isolate renderer from Node.js
            nodeIntegration: false, // Security: no Node.js in renderer
            sandbox: false, // Disable sandbox so preload can use contextBridge
            devTools: true,
            webSecurity: process.env.NODE_ENV === 'production', // Relax in dev for cross-origin backend resources
            allowRunningInsecureContent: false,
        },
    });
    // Prevent new windows from opening
    mainWindow?.webContents.setWindowOpenHandler(({ url }) => {
        electron.shell.openExternal(url);
        return { action: 'deny' };
    });
    // Prevent navigation away from the app
    mainWindow?.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(BACKEND_URL) && !url.startsWith('file://')) {
            event.preventDefault();
        }
    });
    const indexPath = path.join(__dirname, '..', 'src', 'ui', 'index.html');
    mainWindow?.loadFile(indexPath);
    // Force devtools to debug renderer JS errors on user's machine
    mainWindow?.webContents.openDevTools();
    mainWindow?.on('closed', () => { mainWindow = null; });
}
// --- IPC Handlers ---
electron.ipcMain.handle('daemon:start-protection', async (_event, sessionKey) => {
    sendToDaemon({ command: 'start_protection', sessionKey });
    return { ok: true };
});
electron.ipcMain.handle('daemon:stop-protection', async () => {
    sendToDaemon({ command: 'stop_protection' });
    return { ok: true };
});
electron.ipcMain.handle('daemon:get-status', async () => {
    sendToDaemon({ command: 'get_status' });
    return { ok: true };
});
electron.ipcMain.handle('app:get-backend-url', () => BACKEND_URL);
// Soft JS-level blur detection reported to daemon bridge
electron.ipcMain.on('renderer:focus-event', (_event, data) => {
    mainWindow?.webContents.send('daemon:event', {
        type: data.type === 'blur' ? 'focus_loss' : 'focus_regained',
        severity: 'LOW',
        timestamp: new Date().toISOString(),
        payload: data,
    });
});
// --- App lifecycle ---
electron.app.whenReady().then(() => {
    // In dev mode, allow loading cross-origin resources (backend socket.io.js etc.)
    if (process.env.NODE_ENV !== 'production') {
        electron.app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
    }
    createWindow();
    launchDaemon();
    electron.app.on('activate', () => {
        if (electron.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron.app.on('window-all-closed', () => {
    sendToDaemon({ command: 'stop_protection' });
    daemonProcess?.kill();
    if (process.platform !== 'darwin')
        electron.app.quit();
});
// Prevent multiple instances
if (!electron.app.requestSingleInstanceLock()) {
    electron.app.quit();
}
