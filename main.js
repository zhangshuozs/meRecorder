const { app, BrowserWindow, Menu, globalShortcut } = require("electron");
const path = require("path");

function createWindow() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1150,
    height: 740,
    title: "ME录制",
    maximizable: false, // 禁用最大化
    resizable: false, // 禁止用户拉伸窗口
    icon: path.join(__dirname, "ME.ico"), // icon
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      //开启渲染进程使用node
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile("index.html");

  globalShortcut.register("CommandOrControl+Shift+i", function () {
    win.webContents.openDevTools();
  });

  globalShortcut.register("CommandOrControl+R", function () {
    win.webContents.reload();
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  // 注销所有快捷键
  globalShortcut.unregisterAll();
});
