const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("backendAPI", {
  openApp: (data) => {
    const cleanData = JSON.parse(JSON.stringify(data));
    ipcRenderer.send("open-app", cleanData);
  },
  getExternalApps: () => ipcRenderer.invoke("get-external-apps"),
  status: (callback) =>
    ipcRenderer.on("status", (event, data) => callback(data)),
  close: () => ipcRenderer.send("window-close"),
  isInstalled: (appId) => ipcRenderer.invoke("app-is-installed", { appId }),
  install: (appId, githubRepo) => ipcRenderer.invoke("app-install", { appId, githubRepo }),
  launch: (appId, port) => ipcRenderer.invoke("app-launch", { appId, port }),
});
