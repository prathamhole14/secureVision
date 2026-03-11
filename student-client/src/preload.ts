/**
 * Preload Script — the ONLY bridge between Renderer (web) and Main (Node.js).
 * This runs in an isolated context and exposes a minimal, safe API surface.
 * contextIsolation: true means renderer cannot access Node.js APIs directly.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Daemon control
  startProtection: (sessionKey: string) =>
    ipcRenderer.invoke('daemon:start-protection', sessionKey),
  stopProtection: () => ipcRenderer.invoke('daemon:stop-protection'),
  getDaemonStatus: () => ipcRenderer.invoke('daemon:get-status'),

  // Config
  getBackendUrl: () => ipcRenderer.invoke('app:get-backend-url'),

  // Daemon push events (one-way: Main → Renderer)
  onDaemonEvent: (callback: (event: object) => void) => {
    ipcRenderer.on('daemon:event', (_evt, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('daemon:event');
  },
  onDaemonStatus: (callback: (status: { connected: boolean }) => void) => {
    ipcRenderer.on('daemon:status', (_evt, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('daemon:status');
  },

  // Backend commands from server (one-way: Main → Renderer via socket)
  onServerCommand: (callback: (cmd: object) => void) => {
    ipcRenderer.on('server:command', (_evt, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('server:command');
  },

  // Soft sensor: report focus events from renderer
  reportFocusEvent: (type: 'blur' | 'focus') =>
    ipcRenderer.send('renderer:focus-event', { type, timestamp: Date.now() }),
});
