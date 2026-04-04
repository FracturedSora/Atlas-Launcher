const { ipcMain, BrowserWindow } = require("electron");
const path = require("path");
const { fork } = require("child_process");
const AdmZip = require("adm-zip");
const fetch = require("cross-fetch");
const os = require("os");
const {
  promises: fs,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} = require("fs");

const APPS_DIR = path.join(os.homedir(), "AtlasLauncher", "official");
const SETTINGS_DIR = path.join(os.homedir(), "AtlasLauncher");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

const runningServers = {};
const runningExternalServers = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getStoredSettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) return { language: "en" };
    const data = await fs.readFile(SETTINGS_FILE, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    console.error("Error reading settings.json:", e);
    return { language: "en" };
  }
}

async function winDelete(dirPath) {
  const { execSync } = require("child_process");
  const p = dirPath;

  try {
    const out = execSync(
      `wmic process where "name='node.exe'" get ProcessId,CommandLine /format:csv`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
    );
    const needle = p.toLowerCase();
    out.split("\n").forEach((line) => {
      if (!line.toLowerCase().includes(needle)) return;
      const match = line.match(/(\d+)\s*$/);
      if (match) {
        try {
          execSync(`taskkill /F /PID ${match[1]}`, { stdio: "ignore" });
        } catch (_) {}
      }
    });
  } catch (_) {}

  await new Promise((r) => setTimeout(r, 600));

  try {
    execSync(`takeown /F "${p}" /R /D Y`, { stdio: "ignore" });
  } catch (_) {}
  try {
    execSync(`icacls "${p}" /grant *S-1-1-0:F /T /C /Q`, { stdio: "ignore" });
  } catch (_) {}

  await new Promise((r) => setTimeout(r, 300));

  try {
    execSync(`rd /s /q "${p}"`, { stdio: "ignore" });
  } catch (_) {}

  await new Promise((r) => setTimeout(r, 400));
}

async function robustDelete(dirPath) {
  const { rmSync } = require("fs");

  if (!existsSync(dirPath)) return true;

  for (let attempt = 0; attempt < 5; attempt++) {
    if (process.platform === "win32") {
      await winDelete(dirPath);
      if (!existsSync(dirPath)) return true;
    }

    try {
      rmSync(dirPath, { recursive: true, force: true });
    } catch (_) {}
    if (!existsSync(dirPath)) return true;

    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }

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

// ─── IPC Registration ─────────────────────────────────────────────────────────

function registerIpcHandlers({ launchApp, getAppWindow }) {
  // ── open-app ────────────────────────────────────────────────────────────────
  ipcMain.on("open-app", (event, data) => {
    if (data && data.url) {
      launchApp({ url: String(data.url), headers: data.headers });
    } else {
      console.log("Data missing url property");
    }
  });

  // ── window-close ────────────────────────────────────────────────────────────
  ipcMain.on("window-close", () => {
    const win = getAppWindow();
    if (win && !win.isDestroyed()) win.close();
  });

  // ── get-external-apps ───────────────────────────────────────────────────────
  ipcMain.handle("get-external-apps", () => {
    const { readdirSync, readFileSync } = require("fs");
    const externalAppsPath = path.join(
      os.homedir(),
      "AtlasLauncher",
      "externalApps"
    );
    try {
      const folders = readdirSync(externalAppsPath, { withFileTypes: true });
      const apps = folders
        .filter((f) => f.isDirectory())
        .map((folder) => {
          const configPath = path.join(
            externalAppsPath,
            folder.name,
            "config.json"
          );
          const bannerPath = path.join(
            externalAppsPath,
            folder.name,
            "banner.png"
          );
          try {
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

  // ── app-is-installed ────────────────────────────────────────────────────────
  ipcMain.handle("app-is-installed", (event, { appId }) => {
    const serverPath = path.join(APPS_DIR, appId, "server.js");
    return existsSync(serverPath);
  });

  // ── app-check-update ────────────────────────────────────────────────────────
  ipcMain.handle("app-check-update", async (event, { appId, repo }) => {
    const appDir = path.join(APPS_DIR, appId);
    const versionFile = path.join(appDir, "version.json");

    if (!existsSync(versionFile)) return { updateAvailable: true };

    try {
      const currentVersion = JSON.parse(
        require("fs").readFileSync(versionFile, "utf-8")
      ).versionTag;

      const apiRes = await fetch(
        `https://api.github.com/repos/${repo}/releases/latest`,
        { headers: { "User-Agent": "AtlasLauncher" } }
      );

      if (!apiRes.ok) return { updateAvailable: false };

      const releaseData = await apiRes.json();
      const latestVersion = releaseData?.tag_name || "unknown";

      if (!currentVersion || latestVersion !== currentVersion) {
        console.log(
          `[Update] ${appId} update found! ${currentVersion || "None"} -> ${latestVersion}`
        );
        require("fs").writeFileSync(
          versionFile,
          JSON.stringify({ installedAt: Date.now(), versionTag: latestVersion }, null, 2)
        );
        return { updateAvailable: true, latestVersion };
      }

      console.log(`[Update] ${appId} is up to date (${currentVersion}).`);
      return { updateAvailable: false, latestVersion };
    } catch (e) {
      console.error("[Update Check Error]:", e.message);
      return { updateAvailable: false };
    }
  });

  // ── app-install ─────────────────────────────────────────────────────────────
  ipcMain.handle("app-install", async (event, { appId, repo, downloadUrl }) => {
    const appDir = path.join(APPS_DIR, appId);
    const zipPath = path.join(APPS_DIR, `${appId}-update.zip`);

    try {
      let finalUrl = downloadUrl;
      let targetRepo = repo;

      if (finalUrl && !finalUrl.startsWith("http")) {
        targetRepo = finalUrl;
        finalUrl = null;
      }

      if (!finalUrl && targetRepo) {
        console.log(
          `[Install] Querying GitHub API for latest release of ${targetRepo}...`
        );
        const apiRes = await fetch(
          `https://api.github.com/repos/${targetRepo}/releases/latest`,
          { headers: { "User-Agent": "AtlasLauncher" } }
        );
        if (!apiRes.ok)
          throw new Error(
            `GitHub API Error: ${apiRes.status} ${apiRes.statusText}`
          );

        const releaseData = await apiRes.json();
        const targetAssetName = `${appId.toLowerCase()}.zip`;
        const asset = releaseData.assets.find(
          (a) => a.name.toLowerCase() === targetAssetName
        );

        if (!asset)
          throw new Error(
            `Could not find "${targetAssetName}" in the latest release of ${targetRepo}.`
          );

        finalUrl = asset.browser_download_url;
        console.log(`[Install] Found release asset: ${finalUrl}`);
      }

      if (!finalUrl || !finalUrl.startsWith("http"))
        throw new Error("No valid absolute download URL resolved.");

      console.log(`[Install] Downloading ${appId} from ${finalUrl}...`);
      const zipRes = await fetch(finalUrl, {
        headers: { "User-Agent": "AtlasLauncher" },
      });
      if (!zipRes.ok)
        throw new Error(`Download failed: ${zipRes.status} ${zipRes.statusText}`);

      const buffer = Buffer.from(await zipRes.arrayBuffer());
      mkdirSync(APPS_DIR, { recursive: true });
      writeFileSync(zipPath, buffer);

      console.log(`[Install] Extracting ${appId}...`);
      mkdirSync(appDir, { recursive: true });
      const zip = new AdmZip(zipPath);
      zip.getEntries().forEach((entry) => {
        if (entry.isDirectory) return;
        try {
          const dest = path.join(appDir, entry.entryName);
          mkdirSync(path.dirname(dest), { recursive: true });
          writeFileSync(dest, entry.getData());
        } catch (entryErr) {
          if (entryErr.code !== "EPERM") throw entryErr;
        }
      });

      try {
        unlinkSync(zipPath);
      } catch (_) {}

      writeFileSync(
        path.join(appDir, "version.json"),
        JSON.stringify({ installedAt: Date.now(), source: finalUrl }, null, 2)
      );

      console.log(`[Install] Successfully installed ${appId}!`);
      return { success: true };
    } catch (e) {
      console.error(`[Install Error - ${appId}]:`, e.message);
      try {
        if (existsSync(zipPath)) unlinkSync(zipPath);
      } catch (_) {}
      return { success: false, error: e.message };
    }
  });

  // ── get-settings ────────────────────────────────────────────────────────────
  ipcMain.handle("get-settings", async () => {
    return await getStoredSettings();
  });

  // ── update-settings ─────────────────────────────────────────────────────────
  ipcMain.handle("update-settings", async (event, newSettings) => {
    try {
      if (!existsSync(SETTINGS_DIR)) {
        mkdirSync(SETTINGS_DIR, { recursive: true });
      }
      const currentSettings = await getStoredSettings();
      const updated = { ...currentSettings, ...newSettings };
      await fs.writeFile(
        SETTINGS_FILE,
        JSON.stringify(updated, null, 2),
        "utf-8"
      );
      console.log("📂 File written to:", SETTINGS_FILE);
      return { success: true };
    } catch (e) {
      console.error("❌ FS ERROR:", e.message);
      return { success: false, error: e.message };
    }
  });

  // ── app-install-external ────────────────────────────────────────────────────
  ipcMain.handle(
    "app-install-external",
    async (event, { appId, downloadUrl, name, url, contentType }) => {
      const extAppsDir = path.join(os.homedir(), "AtlasLauncher", "externalApps");
      const zipPath = path.join(extAppsDir, `${appId}-install.zip`);

      try {
        if (!downloadUrl) throw new Error("No download URL provided");

        mkdirSync(extAppsDir, { recursive: true });

        let appDir = path.join(extAppsDir, appId);
        try {
          const entries = require("fs").readdirSync(extAppsDir);
          const match = entries.find(
            (e) => e.toLowerCase() === appId.toLowerCase()
          );
          if (match) appDir = path.join(extAppsDir, match);
        } catch (_) {}

        if (existsSync(appDir)) {
          try {
            const { rmSync } = require("fs");
            rmSync(appDir, { recursive: true, force: true });
            await new Promise((r) => setTimeout(r, 400));
          } catch (_) {}
          if (existsSync(appDir)) {
            await new Promise((r) => setTimeout(r, 600));
            try {
              const { rmSync } = require("fs");
              rmSync(appDir, { recursive: true, force: true });
            } catch (_) {}
          }
        }

        appDir = path.join(extAppsDir, appId);
        mkdirSync(appDir, { recursive: true });

        const zipRes = await fetch(downloadUrl);
        if (!zipRes.ok)
          throw new Error(`Download failed: ${zipRes.status} ${zipRes.statusText}`);
        const buffer = Buffer.from(await zipRes.arrayBuffer());
        writeFileSync(zipPath, buffer);

        const zip = new AdmZip(zipPath);
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;
          const dest = path.join(appDir, entry.entryName);
          try {
            mkdirSync(path.dirname(dest), { recursive: true });
            writeFileSync(dest, entry.getData());
          } catch (entryErr) {
            if (entryErr.code !== "EPERM") throw entryErr;
            if (!existsSync(dest)) throw entryErr;
          }
        }

        try {
          unlinkSync(zipPath);
        } catch (_) {}

        const configPath = path.join(appDir, "config.json");
        if (!existsSync(configPath)) {
          writeFileSync(
            configPath,
            JSON.stringify(
              { name: name || appId, url: url || "", contentType: contentType || "sfw" },
              null,
              2
            )
          );
        }

        return { success: true };
      } catch (e) {
        try {
          if (existsSync(zipPath)) unlinkSync(zipPath);
        } catch (_) {}
        return { success: false, error: e.message };
      }
    }
  );

  // ── app-is-installed-external ───────────────────────────────────────────────
  ipcMain.handle("app-is-installed-external", (event, { appId }) => {
    const extAppsDir = path.join(os.homedir(), "AtlasLauncher", "externalApps");
    try {
      const entries = require("fs").readdirSync(extAppsDir);
      const match = entries.find(
        (e) => e.toLowerCase() === appId.toLowerCase()
      );
      if (!match) return false;
      const configPath = path.join(extAppsDir, match, "config.json");
      return existsSync(configPath);
    } catch (_) {
      return false;
    }
  });

  // ── kill-orphan-nodes ───────────────────────────────────────────────────────
  ipcMain.handle("kill-orphan-nodes", async () => {
    const allProcs = [
      ...Object.entries(runningServers),
      ...Object.entries(runningExternalServers),
    ];
    for (const [, proc] of allProcs) {
      try {
        proc.kill();
      } catch (_) {}
    }
    Object.keys(runningServers).forEach((k) => delete runningServers[k]);
    Object.keys(runningExternalServers).forEach(
      (k) => delete runningExternalServers[k]
    );
    await new Promise((r) => setTimeout(r, 800));
    return { success: true };
  });

  // ── app-uninstall ───────────────────────────────────────────────────────────
  ipcMain.handle("app-uninstall", async (event, { appId }) => {
    const appDir = path.join(APPS_DIR, appId);
    try {
      if (runningServers[appId]) {
        try {
          runningServers[appId].kill();
        } catch (_) {}
        delete runningServers[appId];
        await new Promise((r) => setTimeout(r, 800));
      }
      if (!existsSync(appDir)) return { success: true };

      if (process.platform === "win32") {
        await winDelete(appDir);
        if (!existsSync(appDir)) return { success: true };
        await new Promise((r) => setTimeout(r, 1000));
        await winDelete(appDir);
      }

      const deleted = await robustDelete(appDir);
      if (deleted) return { success: true };
      return {
        success: false,
        error: "Could not delete — restart the launcher and try again",
      };
    } catch (e) {
      if (!existsSync(appDir)) return { success: true };
      return { success: false, error: e.message };
    }
  });

  // ── app-uninstall-external ──────────────────────────────────────────────────
  ipcMain.handle("app-uninstall-external", async (event, { appId }) => {
    const extAppsDir = path.join(os.homedir(), "AtlasLauncher", "externalApps");
    const { readdirSync } = require("fs");

    if (runningExternalServers[appId]) {
      try {
        runningExternalServers[appId].kill();
      } catch (_) {}
      delete runningExternalServers[appId];
      await new Promise((r) => setTimeout(r, 800));
    }

    if (runningServers[appId]) {
      try {
        runningServers[appId].kill();
      } catch (_) {}
      delete runningServers[appId];
      await new Promise((r) => setTimeout(r, 400));
    }

    let extDir = path.join(extAppsDir, appId);
    try {
      const entries = readdirSync(extAppsDir);
      const match = entries.find(
        (e) => e.toLowerCase() === appId.toLowerCase()
      );
      if (match) extDir = path.join(extAppsDir, match);
    } catch (_) {}

    if (!existsSync(extDir)) return { success: true };

    if (process.platform === "win32") {
      await winDelete(extDir);
      if (!existsSync(extDir)) return { success: true };
      await new Promise((r) => setTimeout(r, 1000));
      await winDelete(extDir);
    }

    const deleted = await robustDelete(extDir);
    if (deleted) return { success: true };
    return {
      success: false,
      error: "Could not delete — restart the launcher and try again",
    };
  });

  // ── launcher-update ─────────────────────────────────────────────────────────
  ipcMain.handle("launcher-update", async (event, { downloadUrl, fileName }) => {
    const downloadsDir = path.join(os.homedir(), "Downloads");
    const destPath = path.join(downloadsDir, fileName);
    try {
      const res = await fetch(downloadUrl);
      if (!res.ok)
        throw new Error(`Download failed: ${res.status} ${res.statusText}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      mkdirSync(downloadsDir, { recursive: true });
      writeFileSync(destPath, buffer);
      const { shell } = require("electron");
      shell.showItemInFolder(destPath);
      return { success: true, path: destPath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ── app-launch ──────────────────────────────────────────────────────────────
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

    const proc = fork("server.js", [], {
      cwd: appDir,
      env: { ...process.env, PORT: String(appPort) },
      stdio: "pipe",
    });

    runningServers[appId] = proc;
    proc.on("error", (e) => console.error(`[${appId}] server error:`, e));
    proc.stdout?.on("data", (d) =>
      console.log(`[${appId}]`, d.toString().trim())
    );
    proc.stderr?.on("data", (d) =>
      console.error(`[${appId}]`, d.toString().trim())
    );

    await new Promise((r) => setTimeout(r, 1500));
    return { success: true };
  });
}

module.exports = {
  registerIpcHandlers,
  runningServers,
  runningExternalServers,
  getStoredSettings,
};
