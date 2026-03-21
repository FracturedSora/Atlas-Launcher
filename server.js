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

// ─── Official Apps ────────────────────────────────────────────────────────────
const APPS_DIR = path.join(os.homedir(), "AtlasLauncher", "official");
const runningServers = {}; // track official app child processes by appId
const runningExternalServers = {}; // track external app child processes by appId

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

// ─── IPC: External app (open-app) ────────────────────────────────────────────
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

// ─── IPC: External apps list ──────────────────────────────────────────────────
ipcMain.handle("get-external-apps", () => {
  // Use sync reads so Node releases file handles immediately after reading.
  // Async fs.readFile on Windows can leave handles open long enough to block
  // deletion and cause "file in use" errors that require a restart to clear.
  const { readdirSync, readFileSync, statSync } = require("fs");
  const externalAppsPath = path.join(os.homedir(), "AtlasLauncher", "externalApps");
  try {
    const folders = readdirSync(externalAppsPath, { withFileTypes: true });
    const apps = folders
      .filter(f => f.isDirectory())
      .map((folder) => {
        const configPath = path.join(externalAppsPath, folder.name, "config.json");
        const bannerPath = path.join(externalAppsPath, folder.name, "banner.png");
        try {
          // readFileSync releases the handle as soon as the call returns
          const raw = readFileSync(configPath, { encoding: "utf8", flag: "r" });
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
      });
    return apps.filter(Boolean);
  } catch (_) {
    return [];
  }
});

// ─── IPC: Official Apps (install + launch) ────────────────────────────────────

// Check if an official app is installed
ipcMain.handle("app-is-installed", (event, { appId }) => {
  const serverPath = path.join(APPS_DIR, appId, "server.js");
  return existsSync(serverPath);
});

// Check GitHub for updates
ipcMain.handle("app-check-update", async (event, args) => {
  const { appId, repo } = args;
  const versionFile = path.join(APPS_DIR, appId, "version.json");

  // If there's no version file, it needs a fresh install
  if (!require("fs").existsSync(versionFile)) return { updateAvailable: true };

  try {
    const currentVersion = JSON.parse(require("fs").readFileSync(versionFile, "utf-8")).versionTag;

    const apiRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { "User-Agent": "AtlasLauncher" }
    });

    if (!apiRes.ok) return { updateAvailable: false };

    const releaseData = await apiRes.json();
    // Make sure you captured `latestVersion = releaseData.tag_name` earlier in the handler!
        const latestVersion = releaseData?.tag_name || "unknown";

        // 6. Write version info
        writeFileSync(
          path.join(appDir, "version.json"),
          JSON.stringify({
            installedAt: Date.now(),
            source: finalUrl,
            versionTag: latestVersion // <-- ADD THIS LINE
          }, null, 2)
        );
    // Compare versions
    if (!currentVersion || latestVersion !== currentVersion) {
      console.log(`[Update] ${appId} update found! ${currentVersion || "None"} -> ${latestVersion}`);
      return { updateAvailable: true, latestVersion };
    }

    console.log(`[Update] ${appId} is up to date (${currentVersion}).`);
    return { updateAvailable: false, latestVersion };
  } catch (e) {
    console.error("[Update Check Error]:", e.message);
    return { updateAvailable: false }; // Fail safely if offline
  }
});

// Download latest GitHub release zip, extract, delete zip
ipcMain.handle("app-install", async (event, args) => {
  const { appId, repo, downloadUrl } = args;

  const appDir  = path.join(APPS_DIR, appId);
  const zipPath = path.join(APPS_DIR, `${appId}-update.zip`);

  try {
    let finalUrl = downloadUrl;
    let targetRepo = repo;

    // 🛡️ THE FIX: If the frontend passed "FracturedSora/WaifuStuff" into the downloadUrl variable,
    // intercept it and treat it as a GitHub repository string instead.
    if (finalUrl && !finalUrl.startsWith("http")) {
      targetRepo = finalUrl;
      finalUrl = null;
    }

    // 1. If we have a GitHub repo, find the latest release
    if (!finalUrl && targetRepo) {
      console.log(`[Install] Querying GitHub API for latest release of ${targetRepo}...`);
      const apiRes = await fetch(`https://api.github.com/repos/${targetRepo}/releases/latest`, {
        headers: { "User-Agent": "AtlasLauncher" } // GitHub API requires a User-Agent
      });

      if (!apiRes.ok) throw new Error(`GitHub API Error: ${apiRes.status} ${apiRes.statusText}`);

      const releaseData = await apiRes.json();

      // Find the asset that matches our appId (e.g., "waifuanime.zip")
      const targetAssetName = `${appId.toLowerCase()}.zip`;
      const asset = releaseData.assets.find(a => a.name.toLowerCase() === targetAssetName);

      if (!asset) {
        throw new Error(`Could not find "${targetAssetName}" in the latest release of ${targetRepo}.`);
      }

      finalUrl = asset.browser_download_url;
      console.log(`[Install] Found release asset: ${finalUrl}`);
    }

    if (!finalUrl || !finalUrl.startsWith("http")) {
        throw new Error("No valid absolute download URL resolved.");
    }

    // 2. Download the zip file
    console.log(`[Install] Downloading ${appId} from ${finalUrl}...`);
    const zipRes = await fetch(finalUrl, {
      headers: { "User-Agent": "AtlasLauncher" }
    });

    if (!zipRes.ok) throw new Error(`Download failed: ${zipRes.status} ${zipRes.statusText}`);

    const buffer = Buffer.from(await zipRes.arrayBuffer());

    // 3. Write zip to disk
    mkdirSync(APPS_DIR, { recursive: true });
    writeFileSync(zipPath, buffer);

    // 4. Extract into app folder
    console.log(`[Install] Extracting ${appId}...`);
    mkdirSync(appDir, { recursive: true });
    const zip = new AdmZip(zipPath);

    zip.getEntries().forEach(entry => {
      if (entry.isDirectory) return;
      try {
        const dest = path.join(appDir, entry.entryName);
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, entry.getData());
      } catch (entryErr) {
        if (entryErr.code !== "EPERM") throw entryErr;
      }
    });

    // 5. Clean up the zip file
    try { unlinkSync(zipPath); } catch (_) {}

    // 6. Write version info
    writeFileSync(
      path.join(appDir, "version.json"),
      JSON.stringify({ installedAt: Date.now(), source: finalUrl }, null, 2)
    );

    console.log(`[Install] Successfully installed ${appId}!`);
    return { success: true };

  } catch (e) {
    console.error(`[Install Error - ${appId}]:`, e.message);
    try { if (existsSync(zipPath)) unlinkSync(zipPath); } catch (_) {}
    return { success: false, error: e.message };
  }
});

// Install an external app — downloads zip, extracts to externalApps/<id>/
ipcMain.handle("app-install-external", async (event, { appId, downloadUrl, name, url, contentType }) => {
  const extAppsDir = path.join(os.homedir(), "AtlasLauncher", "externalApps");
  const zipPath    = path.join(extAppsDir, `${appId}-install.zip`);

  try {
    if (!downloadUrl) throw new Error("No download URL provided");

    mkdirSync(extAppsDir, { recursive: true });

    // Find the real folder on disk — Windows is case-insensitive so "Comix"
    // and "comix" are the same folder. Scan for any case variant and use it,
    // or fall back to the exact id.
    let appDir = path.join(extAppsDir, appId);
    try {
      const entries = require("fs").readdirSync(extAppsDir);
      const match = entries.find(e => e.toLowerCase() === appId.toLowerCase());
      if (match) appDir = path.join(extAppsDir, match);
    } catch (_) {}

    // Wipe the existing folder so stale/locked files don't cause EPERM
    if (existsSync(appDir)) {
      try {
        const { rmSync } = require("fs");
        rmSync(appDir, { recursive: true, force: true });
        await new Promise(r => setTimeout(r, 400));
      } catch (_) {}
      // If it's still there after rmSync (Windows holding handles), try again
      if (existsSync(appDir)) {
        await new Promise(r => setTimeout(r, 600));
        try {
          const { rmSync } = require("fs");
          rmSync(appDir, { recursive: true, force: true });
        } catch (_) {}
      }
    }

    // Always use the canonical lowercase id going forward
    appDir = path.join(extAppsDir, appId);
    mkdirSync(appDir, { recursive: true });

    // Download the zip
    const zipRes = await fetch(downloadUrl);
    if (!zipRes.ok) throw new Error(`Download failed: ${zipRes.status} ${zipRes.statusText}`);
    const buffer = Buffer.from(await zipRes.arrayBuffer());
    writeFileSync(zipPath, buffer);

    // Extract manually — avoids adm-zip's chmod calls that EPERM on Windows
    const zip = new AdmZip(zipPath);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const dest = path.join(appDir, entry.entryName);
      try {
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, entry.getData());
      } catch (entryErr) {
        if (entryErr.code !== "EPERM") throw entryErr;
        // EPERM on Windows after write usually means the file got written anyway
        // If it's missing, that's a real problem
        if (!existsSync(dest)) throw entryErr;
      }
    }

    try { unlinkSync(zipPath); } catch (_) {}

    // Write config.json so the sidebar picks this app up
    const configPath = path.join(appDir, "config.json");
    if (!existsSync(configPath)) {
      writeFileSync(configPath, JSON.stringify({
        name:        name || appId,
        url:         url  || "",
        contentType: contentType || "sfw",
      }, null, 2));
    }

    return { success: true };
  } catch (e) {
    try { if (existsSync(zipPath)) unlinkSync(zipPath); } catch (_) {}
    return { success: false, error: e.message };
  }
});

// Check if an external app is installed — must have config.json to count
ipcMain.handle("app-is-installed-external", (event, { appId }) => {
  const extAppsDir = path.join(os.homedir(), "AtlasLauncher", "externalApps");
  // Handle case-insensitive folder names on Windows
  try {
    const entries = require("fs").readdirSync(extAppsDir);
    const match = entries.find(e => e.toLowerCase() === appId.toLowerCase());
    if (!match) return false;
    const configPath = path.join(extAppsDir, match, "config.json");
    return existsSync(configPath);
  } catch (_) {
    return false;
  }
});

// ── Windows nuclear delete ───────────────────────────────────────────────────
// 1. taskkill any node.exe with the folder path in its command line
// 2. takeown + icacls to strip ACL locks
// 3. cmd rmdir /s /q
async function winDelete(dirPath) {
  const { execSync } = require("child_process");
  // path.join already uses backslashes on Windows — no replace needed
  const p = dirPath;

  // Kill only node.exe processes running inside this specific folder
  try {
    const out = execSync(
      `wmic process where "name='node.exe'" get ProcessId,CommandLine /format:csv`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
    );
    const needle = p.toLowerCase();
    out.split("\n").forEach(line => {
      if (!line.toLowerCase().includes(needle)) return;
      const match = line.match(/(\d+)\s*$/);
      if (match) {
        try { execSync(`taskkill /F /PID ${match[1]}`, { stdio: "ignore" }); } catch (_) {}
      }
    });
  } catch (_) {}

  await new Promise(r => setTimeout(r, 600));

  // Take ownership so ACLs can't block deletion
  try { execSync(`takeown /F "${p}" /R /D Y`, { stdio: "ignore" }); } catch (_) {}
  try { execSync(`icacls "${p}" /grant *S-1-1-0:F /T /C /Q`, { stdio: "ignore" }); } catch (_) {}

  await new Promise(r => setTimeout(r, 300));

  // rd /s /q deletes the folder AND itself — not just contents
  try { execSync(`rd /s /q "${p}"`, { stdio: "ignore" }); } catch (_) {}

  await new Promise(r => setTimeout(r, 400));
}

// ── Robust delete — works on all platforms ────────────────────────────────────
async function robustDelete(dirPath) {
  const { rmSync } = require("fs");

  if (!existsSync(dirPath)) return true;

  for (let attempt = 0; attempt < 5; attempt++) {
    if (process.platform === "win32") {
      // Nuclear delete every attempt — taskkill + takeown + icacls + rmdir
      await winDelete(dirPath);
      if (!existsSync(dirPath)) return true;
    }

    // Node rmSync as additional fallback
    try { rmSync(dirPath, { recursive: true, force: true }); } catch (_) {}
    if (!existsSync(dirPath)) return true;

    await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
  }

  // Last resort — PowerShell Remove-Item handles junction points and read-only trees
  if (process.platform === "win32") {
    const { execSync } = require("child_process");
    try {
      execSync(
        `powershell -NoProfile -Command "Remove-Item -LiteralPath '${dirPath}' -Recurse -Force -ErrorAction SilentlyContinue"`,
        { stdio: "ignore", timeout: 15000 }
      );
    } catch (_) {}
  }

  return !existsSync(dirPath);
}

// Kill all tracked running servers (official + external) to release file locks
ipcMain.handle("kill-orphan-nodes", async () => {
  const allProcs = [
    ...Object.entries(runningServers),
    ...Object.entries(runningExternalServers),
  ];
  for (const [id, proc] of allProcs) {
    try { proc.kill(); } catch (_) {}
  }
  // Clear both maps
  Object.keys(runningServers).forEach(k => delete runningServers[k]);
  Object.keys(runningExternalServers).forEach(k => delete runningExternalServers[k]);
  // Give OS time to release file handles
  await new Promise(r => setTimeout(r, 800));
  return { success: true };
});

// Uninstall an official app
ipcMain.handle("app-uninstall", async (event, { appId }) => {
  const appDir = path.join(APPS_DIR, appId);
  try {
    if (runningServers[appId]) {
      try { runningServers[appId].kill(); } catch (_) {}
      delete runningServers[appId];
      await new Promise(r => setTimeout(r, 800));
    }
    if (!existsSync(appDir)) return { success: true };

    // On Windows, use cmd rmdir first to break file handle locks
    if (process.platform === "win32") {
      await winDelete(appDir);
      if (!existsSync(appDir)) return { success: true };
      await new Promise(r => setTimeout(r, 1000));
      await winDelete(appDir);
    }

    const deleted = await robustDelete(appDir);
    if (deleted) return { success: true };
    return { success: false, error: "Could not delete — restart the launcher and try again" };
  } catch (e) {
    if (!existsSync(appDir)) return { success: true };
    return { success: false, error: e.message };
  }
});

// Uninstall an external app
ipcMain.handle("app-uninstall-external", async (event, { appId }) => {
  const extAppsDir = path.join(os.homedir(), "AtlasLauncher", "externalApps");
  const { readdirSync } = require("fs");

  // Kill any tracked server process for this app first
  if (runningExternalServers[appId]) {
    try { runningExternalServers[appId].kill(); } catch (_) {}
    delete runningExternalServers[appId];
    await new Promise(r => setTimeout(r, 800));
  }

  // Also kill any official server with the same id just in case
  if (runningServers[appId]) {
    try { runningServers[appId].kill(); } catch (_) {}
    delete runningServers[appId];
    await new Promise(r => setTimeout(r, 400));
  }

  // Find the real folder — handle case mismatch on Windows
  let extDir = path.join(extAppsDir, appId);
  try {
    const entries = readdirSync(extAppsDir);
    const match = entries.find(e => e.toLowerCase() === appId.toLowerCase());
    if (match) extDir = path.join(extAppsDir, match);
  } catch (_) {}

  if (!existsSync(extDir)) return { success: true };

  // On Windows, forcibly close any open handles by calling cmd rmdir first
  if (process.platform === "win32") {
    await winDelete(extDir);
    if (!existsSync(extDir)) return { success: true };
    // Still exists — wait a bit longer and try again
    await new Promise(r => setTimeout(r, 1000));
    await winDelete(extDir);
  }

  const deleted = await robustDelete(extDir);
  if (deleted) return { success: true };
  return { success: false, error: `Could not delete — restart the launcher and try again` };
});

// Download the launcher installer for the user's OS and save it to Downloads
ipcMain.handle("launcher-update", async (event, { downloadUrl, fileName }) => {
  const downloadsDir = path.join(os.homedir(), "Downloads");
  const destPath     = path.join(downloadsDir, fileName);
  try {
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    mkdirSync(downloadsDir, { recursive: true });
    writeFileSync(destPath, buffer);
    // Open the Downloads folder so user can see the installer
    const { shell } = require("electron");
    shell.showItemInFolder(destPath);
    return { success: true, path: destPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Spawn server.js from the app folder and open it in a window
ipcMain.handle("app-launch", async (event, { appId, port: appPort }) => {
  const appDir = path.join(APPS_DIR, appId);
  const serverPath = path.join(appDir, "server.js");

  if (!existsSync(serverPath)) {
    return { success: false, error: "Not installed — server.js not found" };
  }

  // Kill any existing instance of this app
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

  // Wait for server to boot before telling the renderer it's ready
  await new Promise(r => setTimeout(r, 1500));

  return { success: true };
});

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
      devTools: false,
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
  protocol.registerFileProtocol("atlas-file", (request, callback) => {
    let filePath = decodeURIComponent(request.url.replace("atlas-file://", ""));
    if (process.platform === "win32") {
      filePath = filePath.replace(/^\//, "");
    }
    // Use { path } mapping but Electron closes this handle after serving —
    // explicitly pass headers to prevent caching so handles aren't held open
    callback({ path: filePath, headers: { "Cache-Control": "no-store" } });
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

  // Kill all app servers when the launcher exits
  app.on("will-quit", () => {
    [...Object.values(runningServers), ...Object.values(runningExternalServers)].forEach(proc => {
      try { proc.kill(); } catch (_) {}
    });
  });
});
