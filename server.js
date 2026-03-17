// Import dependencies
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const Fastify = require("fastify");
const autoLoad = require("@fastify/autoload");
require("dotenv").config();

// Variables
let appWindow = null;
const port = process.env.PORT;
const fastify = Fastify({
  logger: false,
});

// Launch apps
async function launchApp({ url, headers = {} }) {
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.focus();
    return;
  }

  appWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  const ses = appWindow.webContents.session;

    await ses.clearCache();

    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      Object.keys(headers).forEach((key) => {
        details.requestHeaders[key] = headers[key];
      });

      callback({ requestHeaders: details.requestHeaders });
    });

  appWindow.loadURL(url, { url });

  appWindow.webContents.on("did-finish-load", () => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("status", { status: "open" });
    });
  });

  appWindow.on("closed", () => {
    appWindow = null;
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send("status", { status: "closed", url: null })
    );
  });
}

ipcMain.on("open-app", (event, data) => {
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.close();
  } else {
    if (data && data.url) {
      launchApp({
        url: String(data.url),
        headers: data.headers
      });
    } else {
      console.log("Data missing url property");
    }
  }
});

// Create the launcher window
const createLauncherWindow = () => {
  launcherWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  launcherWindow.loadFile("src/views/home.html");
  launcherWindow.show();
};

fastify.register(autoLoad, {
  dir: path.join(__dirname, "src", "api"),
  options: {
    prefix: "/api/v1",
  },
});

app.whenReady().then(async () => {
  try {
    // Write to logs file stating it successfully started
    fastify.listen({ port: port }, function (error) {
      if (error) {
        // log to log file
      }
    });
  } catch (error) {
    // Write to logs file here
  }

  createLauncherWindow();
});
