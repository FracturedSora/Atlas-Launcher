// Import dependencies
const { app, BrowserWindow, ipcMain, protocol } = require("electron");
const path = require("path");
const Fastify = require("fastify");
const autoLoad = require("@fastify/autoload");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");
const fetch = require("cross-fetch");
const { promises: fs } = require("fs");
const os = require("os");
const AdmZip = require("adm-zip");

const engine = require("./src/engine/index");

const waifuAnime = require("./src/WaifuAnime/hook");
const waifuManga = require("./src/WaifuManga/hook");
const waifuBoard = require("./src/WaifuBoard/hook");

const {
  registerIpcHandlers,
  runningServers,
  runningExternalServers,
  getStoredSettings,
} = require("./ipc");

const isPackaged = app
  ? app.isPackaged
  : process.mainModule?.filename.includes("app.asar");
const envPath = isPackaged
  ? path.join(process.resourcesPath, ".env")
  : path.resolve(process.cwd(), ".env");
require("dotenv").config({ path: envPath });

let appWindow = null;
const getAppWindow = () => appWindow;
let adblocker = null;
const port = process.env.PORT;
const fastify = Fastify({ logger: false });

// ─── Ad Blocker ───────────────────────────────────────────────────────────────
const FILTER_LISTS = [
  "https://easylist.to/easylist/easylist.txt",
  "https://easylist.to/easylist/easyprivacy.txt",
  "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt",
  "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters-2020.txt",
  "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt",
  "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt",
  "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/resource-abuse.txt",
  "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt",
  "https://filters.adtidy.org/extension/ublock/filters/2.txt",
  "https://filters.adtidy.org/extension/ublock/filters/11.txt",
  "https://filters.adtidy.org/extension/ublock/filters/3.txt",
  "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances.txt",
  "https://easylist.to/easylist/fanboy-annoyance.txt",
];

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function initAdBlocker() {
  const cachePath = isPackaged
    ? path.join(process.resourcesPath, "engine.bin")
    : path.resolve(process.cwd(), "engine.bin");

  try {
    const stat = await fs.stat(cachePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > CACHE_MAX_AGE_MS) {
      await fs.unlink(cachePath);
      console.log("Ad blocker cache expired, refreshing...");
    } else {
      console.log(
        `Ad blocker cache is fresh (${Math.round(ageMs / 60000)}m old), loading from disk...`
      );
    }
  } catch (_) {
    console.log("No ad blocker cache found, building...");
  }

  adblocker = await ElectronBlocker.fromLists(
    fetch,
    FILTER_LISTS,
    { enableCompression: true },
    {
      path: cachePath,
      read: fs.readFile,
      write: fs.writeFile,
    }
  );

  console.log("Ad blocker ready.");
}

const AD_REMOVAL_SCRIPT = `
(function() {
  if (window.__adRemoverActive) return;
  window.__adRemoverActive = true;

  const AD_SELECTORS = [
    '[id*="banner" i]', '[class*="banner" i]',
    '[id*="advert" i]', '[class*="advert" i]',
    '[id*="-ad-" i]',  '[class*="-ad-" i]',
    '[id*="_ad_" i]',  '[class*="_ad_" i]',
    '[id*="ad-slot" i]', '[class*="ad-slot" i]',
    '[id*="ad-wrap" i]', '[class*="ad-wrap" i]',
    '[id*="adsbygoogle" i]', '[class*="adsbygoogle" i]',
    '[id*="sponsor" i]', '[class*="sponsor" i]',
    '[id*="promo" i]', '[class*="promo" i]',
    'ins.adsbygoogle',
    'iframe[src*="doubleclick"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="adservice"]',
  ];

  function removeAds(root) {
    AD_SELECTORS.forEach(sel => {
      try { root.querySelectorAll(sel).forEach(el => el.remove()); } catch(_) {}
    });
  }

  removeAds(document);

  const observer = new MutationObserver(mutations => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        AD_SELECTORS.forEach(sel => {
          try { if (node.matches(sel)) node.remove(); } catch(_) {}
        });
        removeAds(node);
      });
    });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
`;

// ─── App Window (external/official apps) ─────────────────────────────────────
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
      devTools: true,
    },
  });

  const ses = appWindow.webContents.session;

  if (adblocker) {
    adblocker.enableBlockingInSession(ses);
  }

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    Object.keys(headers).forEach((key) => {
      details.requestHeaders[key] = headers[key];
    });
    callback({ requestHeaders: details.requestHeaders });
  });

  const contentType = headers["x-content-type"] || "sfw";

  appWindow.webContents.on("did-navigate", () => {
    appWindow.webContents
      .executeJavaScript(`localStorage.setItem("contentType", "${contentType}");`)
      .catch(console.error);
  });

  appWindow.webContents.on("did-finish-load", () => {
    appWindow.webContents.executeJavaScript(AD_REMOVAL_SCRIPT).catch(() => {});
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("status", { status: "open" });
    });
  });

  appWindow.loadURL(url, { url });

  appWindow.on("closed", () => {
    appWindow = null;
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send("status", { status: "closed", url: null })
    );
  });
}

// ─── Launcher Window ──────────────────────────────────────────────────────────
const createLauncherWindow = () => {
  launcherWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
  });
  launcherWindow.loadFile("src/views/home.html");
  launcherWindow.show();
};

// ─── Fastify API ──────────────────────────────────────────────────────────────
fastify.register(autoLoad, {
  dir: path.join(__dirname, "src", "api"),
  options: { prefix: "/api/v1" },
});

// ─── App Ready ────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  getStoredSettings();

  engine.load();

  protocol.registerFileProtocol("atlas-file", (request, callback) => {
    let filePath = decodeURIComponent(request.url.replace("atlas-file://", ""));
    if (process.platform === "win32") {
      filePath = filePath.replace(/^\//, "");
    }
    callback({ path: filePath, headers: { "Cache-Control": "no-store" } });
  });

  // Register all IPC handlers, passing launchApp so open-app can use it
  registerIpcHandlers({ launchApp, getAppWindow });

  waifuAnime.start();
  waifuManga.start();
  waifuBoard.start();

  initAdBlocker().then(() => {
    if (appWindow && !appWindow.isDestroyed()) {
      adblocker.enableBlockingInSession(appWindow.webContents.session);
    }
  });

  try {
    fastify.listen({ port }, function (error) {
      if (error) {
        /* log */
      }
    });
  } catch (error) {
    /* log */
  }

  createLauncherWindow();

  app.on("will-quit", () => {
    [...Object.values(runningServers), ...Object.values(runningExternalServers)].forEach(
      (proc) => {
        try {
          proc.kill();
        } catch (_) {}
      }
    );
    waifuAnime.stop();
    waifuManga.stop();
    waifuBoard.stop();
  });
});
