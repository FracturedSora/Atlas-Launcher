const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("backendAPI", {
  openApp: (data) => {
    const cleanData = JSON.parse(JSON.stringify(data));
    ipcRenderer.send("open-app", cleanData);
  },
  status: (callback) =>
    ipcRenderer.on("status", (event, data) => callback(data)),
  close: () => ipcRenderer.send("window-close"),
});
