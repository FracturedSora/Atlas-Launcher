const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("backendAPI", {

  openApp: (data) => {
    const cleanData = JSON.parse(JSON.stringify(data));
    ipcRenderer.send("open-app", cleanData);
  },

  status: (callback) =>
    ipcRenderer.on("status", (event, data) => callback(data)),

  close: () => ipcRenderer.send("window-close"),

  getExternalApps: () => ipcRenderer.invoke("get-external-apps"),

  isInstalled: (appId) =>
    ipcRenderer.invoke("app-is-installed", { appId }),

  install: (appId, downloadUrl) =>
    ipcRenderer.invoke("app-install", { appId, downloadUrl }),

  launch: (appId, port) =>
    ipcRenderer.invoke("app-launch", { appId, port }),

  isInstalledExternal: (appId) =>
    ipcRenderer.invoke("app-is-installed-external", { appId }),

  installExternal: (appId, downloadUrl, name, url, contentType) =>
    ipcRenderer.invoke("app-install-external", { appId, downloadUrl, name, url, contentType }),

  killOrphanNodes: () =>
    ipcRenderer.invoke("kill-orphan-nodes"),

  uninstall: (appId) =>
    ipcRenderer.invoke("app-uninstall", { appId }),

  uninstallExternal: (appId) =>
    ipcRenderer.invoke("app-uninstall-external", { appId }),

  updateLauncher: (downloadUrl, fileName) =>
    ipcRenderer.invoke("launcher-update", { downloadUrl, fileName }),
});
