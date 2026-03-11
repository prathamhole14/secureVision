"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/main.ts
var import_electron = require("electron");
var path = __toESM(require("path"));
var import_child_process = require("child_process");
var net = __toESM(require("net"));
var mainWindow = null;
var daemonProcess = null;
var daemonSocket = null;
var BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
var DAEMON_SOCKET_PATH = process.platform === "win32" ? "\\\\.\\pipe\\anticheat_daemon" : "/tmp/anticheat_daemon.sock";
function connectToDaemon() {
  daemonSocket = net.createConnection(DAEMON_SOCKET_PATH, () => {
    console.log("[Daemon] Connected to security daemon");
    mainWindow?.webContents.send("daemon:status", { connected: true });
  });
  daemonSocket.on("data", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log("[Daemon] Event:", msg);
      mainWindow?.webContents.send("daemon:event", msg);
    } catch {
    }
  });
  daemonSocket.on("close", () => {
    console.log("[Daemon] Socket closed, attempting reconnect...");
    mainWindow?.webContents.send("daemon:status", { connected: false });
    setTimeout(connectToDaemon, 3e3);
  });
  daemonSocket.on("error", (err) => {
    console.warn("[Daemon] Socket error:", err.message);
  });
}
function launchDaemon() {
  const daemonPath = path.join(__dirname, "..", "daemon", "anticheat-daemon");
  try {
    daemonProcess = (0, import_child_process.spawn)(daemonPath, [], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    daemonProcess.stdout?.on("data", (d) => console.log("[Daemon stdout]", d.toString()));
    daemonProcess.stderr?.on("data", (d) => console.error("[Daemon stderr]", d.toString()));
    daemonProcess.on("error", (err) => {
      console.warn(`[Daemon] Failed to start daemon process: ${err.message}. Ensure it is compiled and placed at ${daemonPath}.`);
      daemonProcess = null;
    });
    daemonProcess.on("exit", (code) => {
      console.log(`[Daemon] Exited with code ${code}`);
      daemonProcess = null;
    });
    setTimeout(connectToDaemon, 1e3);
  } catch (err) {
    console.warn("[Daemon] Could not launch daemon binary (expected in dev mode):", err.message);
    setTimeout(connectToDaemon, 500);
  }
}
function sendToDaemon(message) {
  if (daemonSocket?.writable) {
    daemonSocket.write(JSON.stringify(message) + "\n");
  }
}
function createWindow() {
  mainWindow = new import_electron.BrowserWindow({
    width: 1280,
    height: 800,
    // Kiosk mode in production:
    fullscreen: process.env.NODE_ENV === "production",
    kiosk: process.env.NODE_ENV === "production",
    resizable: process.env.NODE_ENV !== "production",
    frame: process.env.NODE_ENV !== "production",
    alwaysOnTop: process.env.NODE_ENV === "production",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      // Security: isolate renderer from Node.js
      nodeIntegration: false,
      // Security: no Node.js in renderer
      sandbox: false,
      // Disable sandbox so preload can use contextBridge
      devTools: true,
      webSecurity: process.env.NODE_ENV === "production",
      // Relax in dev for cross-origin backend resources
      allowRunningInsecureContent: false
    }
  });
  mainWindow?.webContents.setWindowOpenHandler(({ url }) => {
    import_electron.shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow?.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(BACKEND_URL) && !url.startsWith("file://")) {
      event.preventDefault();
    }
  });
  const indexPath = path.join(__dirname, "..", "src", "ui", "index.html");
  mainWindow?.loadFile(indexPath);
  mainWindow?.webContents.openDevTools();
  mainWindow?.on("closed", () => {
    mainWindow = null;
  });
}
import_electron.ipcMain.handle("daemon:start-protection", async (_event, sessionKey) => {
  sendToDaemon({ command: "start_protection", sessionKey });
  return { ok: true };
});
import_electron.ipcMain.handle("daemon:stop-protection", async () => {
  sendToDaemon({ command: "stop_protection" });
  return { ok: true };
});
import_electron.ipcMain.handle("daemon:get-status", async () => {
  sendToDaemon({ command: "get_status" });
  return { ok: true };
});
import_electron.ipcMain.handle("app:get-backend-url", () => BACKEND_URL);
import_electron.ipcMain.on("renderer:focus-event", (_event, data) => {
  mainWindow?.webContents.send("daemon:event", {
    type: data.type === "blur" ? "focus_loss" : "focus_regained",
    severity: "LOW",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    payload: data
  });
});
import_electron.app.whenReady().then(() => {
  if (process.env.NODE_ENV !== "production") {
    import_electron.app.commandLine.appendSwitch("disable-features", "OutOfBlinkCors");
  }
  createWindow();
  launchDaemon();
  import_electron.app.on("activate", () => {
    if (import_electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
import_electron.app.on("window-all-closed", () => {
  sendToDaemon({ command: "stop_protection" });
  daemonProcess?.kill();
  if (process.platform !== "darwin") import_electron.app.quit();
});
if (!import_electron.app.requestSingleInstanceLock()) {
  import_electron.app.quit();
}
