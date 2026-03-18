// Import dependencies
const { app, BrowserWindow, ipcMain, protocol } = require("electron");
const path = require("path");
const Fastify = require("fastify");
const autoLoad = require("@fastify/autoload");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");
const fetch = require("cross-fetch");
const { promises: fs, mkdirSync, writeFileSync, unlinkSync, existsSync } = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const AdmZip = require("adm-zip");

const isPackaged = app ? app.isPackaged : process.mainModule?.filename.includes('app.asar');
const envPath = isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.resolve(process.cwd(), '.env');
require('dotenv').config({ path: envPath });

let appWindow = null;
let adblocker = null;
const port = process.env.PORT;
const fastify = Fastify({ logger: false });

const APPS_DIR = path.join(os.homedir(), "AtlasLauncher", "official");
const runningServers = {};

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
      console.log(`Ad blocker cache is fresh (${Math.round(ageMs / 60000)}m old), loading from disk...`);
    }
  } catch (_) {
    console.log("No ad blocker cache found, building...");
  }

  adblocker = await ElectronBlocker.fromLists(fetch, FILTER_LISTS, {
    enableCompression: true,
  }, {
    path: cachePath,
    read: fs.readFile,
    write: fs.writeFile,
  });

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
      devTools: false,
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
    appWindow.webContents.executeJavaScript(`
      localStorage.setItem("contentType", "${contentType}");
    `).catch(console.error);
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

ipcMain.on("open-app", (event, data) => {
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.close();
  } else {
    if (data && data.url) {
      launchApp({ url: String(data.url), headers: data.headers });
    } else {
      console.log("Data missing url property");
    }
  }
});

ipcMain.handle("get-external-apps", async () => {
  const externalAppsPath = path.join(os.homedir(), "AtlasLauncher", "externalApps");
  try {
    const folders = await fs.readdir(externalAppsPath, { withFileTypes: true });
    const apps = await Promise.all(
      folders
        .filter(f => f.isDirectory())
        .map(async (folder) => {
          try {
            const configPath = path.join(externalAppsPath, folder.name, "config.json");
            const bannerPath = path.join(externalAppsPath, folder.name, "banner.png");
            const raw = await fs.readFile(configPath, "utf-8");
            const config = JSON.parse(raw);
            return {
              id: folder.name,
              url: config.url,
              name: config.name || folder.name,
              bannerPath,
            };
          } catch (_) {
            return null;
          }
        })
    );
    return apps.filter(Boolean);
  } catch (_) {
    return [];
  }
});

ipcMain.handle("app-is-installed", (event, { appId }) => {
  const serverPath = path.join(APPS_DIR, appId, "server.js");
  return existsSync(serverPath);
});

ipcMain.handle("app-install", async (event, { appId, githubRepo }) => {
  const appDir = path.join(APPS_DIR, appId);
  const zipPath = path.join(APPS_DIR, `${appId}-update.zip`);
  const versionFile = path.join(appDir, "version.json");

  try {
    // 1. Fetch latest release info from GitHub
    const apiRes = await fetch(`https://api.github.com/repos/${githubRepo}/releases/latest`);
    const release = await apiRes.json();
    const latestVersion = release.tag_name; // e.g. "v1.0.4"
    const asset = release.assets?.[0];
    if (!asset) throw new Error("No release asset found on latest release");

    // 2. Compare against locally installed version
    if (existsSync(versionFile)) {
      const local = JSON.parse(readFileSync(versionFile, "utf-8"));

      if (local.version === latestVersion) {
        // Already up to date — do nothing
        return { success: true, updated: false, version: latestVersion };
      }

      // Check if enough time has passed since last update check (6 hours)
      const SIX_HOURS = 6 * 60 * 60 * 1000;
      const lastChecked = local.lastChecked || 0;
      if (Date.now() - lastChecked < SIX_HOURS) {
        return { success: true, updated: false, version: local.version };
      }
    }

    // 3. New version available — download the zip
    const zipRes = await fetch(asset.browser_download_url);
    const buffer = Buffer.from(await zipRes.arrayBuffer());
    mkdirSync(APPS_DIR, { recursive: true });
    writeFileSync(zipPath, buffer);

    // 4. Extract into app folder
    mkdirSync(appDir, { recursive: true });
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(appDir, true);

    // 5. Clean up zip
    unlinkSync(zipPath);

    // 6. Save version + timestamp so we don't re-check too soon
    writeFileSync(versionFile, JSON.stringify({
      version: latestVersion,
      lastChecked: Date.now()
    }, null, 2));

    return { success: true, updated: true, version: latestVersion };

  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("app-launch", async (event, { appId, port: appPort }) => {
  const appDir = path.join(APPS_DIR, appId);
  const serverPath = path.join(appDir, "server.js");

  if (!existsSync(serverPath)) {
    return { success: false, error: "Not installed — server.js not found" };
  }

  if (runningServers[appId]) {
    runningServers[appId].kill();
    delete runningServers[appId];
  }

  const proc = spawn("node", ["server.js"], {
    cwd: appDir,
    env: { ...process.env, PORT: String(appPort) },
  });

  runningServers[appId] = proc;
  proc.on("error", (e) => console.error(`[${appId}] server error:`, e));
  proc.stdout?.on("data", (d) => console.log(`[${appId}]`, d.toString().trim()));
  proc.stderr?.on("data", (d) => console.error(`[${appId}]`, d.toString().trim()));

  await new Promise(r => setTimeout(r, 1500));

  return { success: true };
});

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

fastify.register(autoLoad, {
  dir: path.join(__dirname, "src", "api"),
  options: { prefix: "/api/v1" },
});

app.whenReady().then(async () => {
  protocol.registerFileProtocol("atlas-file", (request, callback) => {
    let filePath = decodeURIComponent(request.url.replace("atlas-file://", ""));
    if (process.platform === "win32") {
      filePath = filePath.replace(/^\//, "");
    }
    callback({ path: filePath });
  });

  initAdBlocker().then(() => {
    if (appWindow && !appWindow.isDestroyed()) {
      adblocker.enableBlockingInSession(appWindow.webContents.session);
    }
  });

  try {
    fastify.listen({ port: port }, function (error) {
      if (error) { /* log */ }
    });
  } catch (error) { /* log */ }

  createLauncherWindow();

  app.on("will-quit", () => {
    Object.values(runningServers).forEach(proc => {
      try { proc.kill(); } catch (_) {}
    });
  });
});
