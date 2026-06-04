const { app, BrowserWindow, ipcMain } = require('electron');
console.log("App:", typeof app);
console.log("ipcMain:", typeof ipcMain);
if (app) app.quit();
