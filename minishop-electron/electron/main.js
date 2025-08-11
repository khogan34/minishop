const { app, BrowserWindow } = require('electron');
const path = require('path');
const isDev = process.env.ELECTRON_START_URL;

function createWindow () {
  const win = new BrowserWindow({
    width: 1400, height: 900,
    webPreferences: {
      contextIsolation: true
    }
  });

  if (isDev) {
    win.loadURL(process.env.ELECTRON_START_URL);
    // win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  if (process.env.VITE_DEV_SERVER_URL) {
    process.env.ELECTRON_START_URL = process.env.VITE_DEV_SERVER_URL;
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
