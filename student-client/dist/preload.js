"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Preload Script — the ONLY bridge between Renderer (web) and Main (Node.js).
 * This runs in an isolated context and exposes a minimal, safe API surface.
 * contextIsolation: true means renderer cannot access Node.js APIs directly.
 */
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // Daemon control
    startProtection: (sessionKey) => electron_1.ipcRenderer.invoke('daemon:start-protection', sessionKey),
    stopProtection: () => electron_1.ipcRenderer.invoke('daemon:stop-protection'),
    getDaemonStatus: () => electron_1.ipcRenderer.invoke('daemon:get-status'),
    // Config
    getBackendUrl: () => electron_1.ipcRenderer.invoke('app:get-backend-url'),
    // Daemon push events (one-way: Main → Renderer)
    onDaemonEvent: (callback) => {
        electron_1.ipcRenderer.on('daemon:event', (_evt, data) => callback(data));
        return () => electron_1.ipcRenderer.removeAllListeners('daemon:event');
    },
    onDaemonStatus: (callback) => {
        electron_1.ipcRenderer.on('daemon:status', (_evt, data) => callback(data));
        return () => electron_1.ipcRenderer.removeAllListeners('daemon:status');
    },
    // Backend commands from server (one-way: Main → Renderer via socket)
    onServerCommand: (callback) => {
        electron_1.ipcRenderer.on('server:command', (_evt, data) => callback(data));
        return () => electron_1.ipcRenderer.removeAllListeners('server:command');
    },
    // Soft sensor: report focus events from renderer
    reportFocusEvent: (type) => electron_1.ipcRenderer.send('renderer:focus-event', { type, timestamp: Date.now() }),
});
