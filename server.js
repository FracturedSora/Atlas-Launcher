// Import dependencies
const { app, BrowserWindow } = require("electron");
const path = require("path");
const Fastify = require("fastify");

require("dotenv").config();

// Variables
const port = process.env.PORT;
const fastify = Fastify({
  logger: false,
});

// Create the launcher window
const createLauncherWindow = () => {
  launcherWindow = new BrowserWindow({
    width: 2020,
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
