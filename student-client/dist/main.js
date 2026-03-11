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
var path = __toESM(require("path"));
var import_child_process = require("child_process");
var net = __toESM(require("net"));
var { app, BrowserWindow, ipcMain, shell } = require("electron");
var mainWindow = null;
var daemonProcess = null;
var daemonSocket = null;
var BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
var DAEMON_SOCKET_PATH = process.platform === "win32" ? "\\\\.\\pipe\\anticheat_daemon" : "/tmp/anticheat_daemon.sock";
var reconnectDelay = 2e3;
function connectToDaemon() {
  daemonSocket = net.createConnection(DAEMON_SOCKET_PATH, () => {
    console.log("[Daemon] Connected to security daemon");
    reconnectDelay = 2e3;
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
    if (process.env.NODE_ENV === "production" || reconnectDelay < 1e4) {
      console.log(`[Daemon] Socket closed, attempting reconnect in ${reconnectDelay}ms...`);
    }
    mainWindow?.webContents.send("daemon:status", { connected: false });
    setTimeout(connectToDaemon, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 3e4);
  });
  daemonSocket.on("error", (err) => {
    if (process.env.NODE_ENV !== "production" && err.code === "ENOENT") {
    } else {
      console.warn("[Daemon] Socket error:", err.message);
    }
    if (process.env.NODE_ENV === "production" || reconnectDelay < 1e4) {
      console.log(`[Daemon] Socket error, attempting reconnect in ${reconnectDelay}ms...`);
    }
    mainWindow?.webContents.send("daemon:status", { connected: false });
    setTimeout(connectToDaemon, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 3e4);
  });
}
function launchDaemon() {
  const daemonBinary = process.platform === "win32" ? "anticheat-daemon.exe" : "anticheat-daemon";
  const daemonPath = path.join(__dirname, "..", "daemon", daemonBinary);
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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    // Exam client should ideally be fullscreen in dev too for testing the experience,
    // but at the very least we should allow it to be maximized when requested.
    fullscreen: true,
    kiosk: true,
    resizable: false,
    frame: false,
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
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow?.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(BACKEND_URL) && !url.startsWith("file://")) {
      event.preventDefault();
    }
  });
  const indexPath = path.join(__dirname, "..", "src", "ui", "index.html");
  mainWindow?.loadFile(indexPath);
  mainWindow?.on("closed", () => {
    mainWindow = null;
  });
}
ipcMain.handle("daemon:start-protection", async (_event, sessionKey) => {
  sendToDaemon({ command: "start_protection", sessionKey });
  return { ok: true };
});
ipcMain.handle("daemon:stop-protection", async () => {
  sendToDaemon({ command: "stop_protection" });
  return { ok: true };
});
ipcMain.handle("daemon:get-status", async () => {
  sendToDaemon({ command: "get_status" });
  return { ok: true };
});
ipcMain.handle("app:get-backend-url", () => BACKEND_URL);
ipcMain.handle("app:request-fullscreen", async () => {
  if (mainWindow) {
    mainWindow.maximize();
    mainWindow.setFullScreen(true);
    mainWindow.setAlwaysOnTop(true, "screen-saver");
  }
  return { ok: true };
});
ipcMain.handle("app:close", async () => {
  if (daemonProcess) {
    daemonProcess.kill();
  }
  app.exit(0);
});
ipcMain.on("renderer:focus-event", (_event, data) => {
  mainWindow?.webContents.send("daemon:event", {
    type: data.type === "blur" ? "focus_loss" : "focus_regained",
    severity: "LOW",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    payload: data
  });
});
app.whenReady().then(() => {
  if (process.env.NODE_ENV !== "production") {
    app.commandLine.appendSwitch("disable-features", "OutOfBlinkCors");
  }
  createWindow();
  launchDaemon();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  sendToDaemon({ command: "stop_protection" });
  daemonProcess?.kill();
  if (process.platform !== "darwin") app.quit();
});
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
