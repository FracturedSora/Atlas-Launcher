const REGISTRY_SOURCES = [
  "https://raw.githubusercontent.com/FracturedSora/atlas-external-apps/main/registry.json",
  "https://raw.githubusercontent.com/Knight-Of-Meta/External-Apps/main/registry.json",
];

const LAUNCHER_REPO   = "FracturedSora/Atlas-Launcher";
const CURRENT_VERSION = "Build-12W9B26-3D";

let allApps        = [];
let externalApps   = [];
let installedIds   = new Set();
let activeFilter   = "all";
let searchQuery    = "";

const toastStack = (() => {
  const el = document.createElement("div");
  el.className = "toast-stack";
  document.body.appendChild(el);
  return el;
})();

function toast(msg, type = "info", duration = 3500) {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `<div class="toast-dot"></div><span>${msg}</span>`;
  toastStack.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

document.querySelectorAll(".market-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".market-tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".market-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "installed") renderInstalled();
    if (btn.dataset.tab === "launcher")  checkLauncherUpdate();
  });
});

document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    renderBrowse();
  });
});

document.getElementById("market-search").addEventListener("input", e => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderBrowse();
  if (document.getElementById("panel-installed").classList.contains("active"))
    renderInstalled();
});

async function loadRegistry() {
  const results = await Promise.allSettled(
    REGISTRY_SOURCES.map(url =>
      fetch(url).then(r => {
        if (!r.ok) throw new Error(`${url} returned ${r.status}`);
        return r.json();
      })
    )
  );

  const seen = new Set();
  allApps = [];

  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.warn(`Registry source ${i + 1} failed:`, result.reason);
      return;
    }
    const apps = result.value?.apps || [];
    apps.forEach(app => {
      if (!app.id || seen.has(app.id)) return;
      seen.add(app.id);
      allApps.push(app);
    });
  });

  if (!allApps.length) {
    document.getElementById("browse-grid").innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>
        <p>Could not load any registries. Check your connection.</p>
      </div>`;
    return;
  }

  await loadExternalApps();
  await refreshInstalledSet();
  renderBrowse();
  updateInstalledCount();
}

async function loadExternalApps() {
  try {
    externalApps = await window.backendAPI.getExternalApps() || [];
  } catch (_) {
    externalApps = [];
  }
}

async function refreshInstalledSet() {
  installedIds.clear();
  await Promise.all(allApps.map(async app => {
    try {
      const isExt = (app.type || "external") === "external";
      const installed = isExt
        ? await window.backendAPI.isInstalledExternal(app.id)
        : await window.backendAPI.isInstalled(app.id);
      if (installed) installedIds.add(app.id);
    } catch (_) {}
  }));
  externalApps.forEach(app => installedIds.add(app.id));
}

function updateInstalledCount() {
  document.getElementById("installed-count").textContent = installedIds.size;
}

function renderBrowse() {
  const grid = document.getElementById("browse-grid");
  const contentType = localStorage.getItem("contentType") || "sfw";

  let filtered = allApps.filter(app => {
    if ((app.contentType || "sfw").toLowerCase() === "nsfw" && contentType !== "nsfw") return false;
    if (activeFilter !== "all") {
      if (activeFilter === "nsfw" && (app.contentType || "sfw").toLowerCase() !== "nsfw") return false;
      if (activeFilter !== "nsfw" && (app.category || "").toLowerCase() !== activeFilter) return false;
    }
    if (searchQuery) {
      const hay = `${app.name} ${app.description} ${app.author}`.toLowerCase();
      if (!hay.includes(searchQuery)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"/></svg>
        <p>No apps match your search</p>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(app => buildRegistryCard(app, false)).join("");
  attachCardListeners(grid);
}

function renderInstalled() {
  const grid   = document.getElementById("installed-grid");
  const search = searchQuery;

  const registryInstalled = allApps.filter(a => installedIds.has(a.id));
  const registryIds       = new Set(allApps.map(a => a.id));
  const externalOnly      = externalApps.filter(a => !registryIds.has(a.id));

  let regCards = registryInstalled;
  let extCards = externalOnly;

  if (search) {
    regCards = regCards.filter(a => `${a.name} ${a.description || ""}`.toLowerCase().includes(search));
    extCards = extCards.filter(a => (a.name || a.id).toLowerCase().includes(search));
  }

  const cards = [
    ...regCards.map(app => buildRegistryCard(app, true)),
    ...extCards.map(app => buildExternalCard(app)),
  ];

  if (!cards.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg>
        <p>${search ? "No installed apps match your search" : "No apps installed yet"}</p>
      </div>`;
    return;
  }

  grid.innerHTML = cards.join("");
  attachCardListeners(grid);
}

function buildRegistryCard(app, isInstalledView = false) {
  const installed = installedIds.has(app.id);
  const isNsfw    = (app.contentType || "sfw").toLowerCase() === "nsfw";
  const category  = (app.category || "media").toLowerCase();

  const banner = app.banner
    ? `<img class="app-card-banner" src="${app.banner}" alt="" loading="lazy" />`
    : `<div class="app-card-banner-placeholder">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 0 1 2.828 0L16 16m-2-2 1.586-1.586a2 2 0 0 1 2.828 0L20 14m-6-6h.01M6 20h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z"/></svg>
       </div>`;

  const icon = app.icon
    ? `<img class="app-icon" src="${app.icon}" alt="${app.name}" loading="lazy" />`
    : `<div class="app-icon-placeholder">${(app.name || "?")[0]}</div>`;

  let actionBtn;
  if (isInstalledView) {
    actionBtn = `
      <div style="display:flex;gap:6px;">
        <button class="btn-update-app"
          data-id="${app.id}"
          data-url="${app.downloadUrl || ""}"
          data-name="${app.name}"
          data-type="${app.type || "external"}"
          data-appurl="${app.url || ""}"
          data-contenttype="${app.contentType || "sfw"}">Update</button>
        <button class="btn-uninstall" data-id="${app.id}" data-name="${app.name}" data-type="${app.type || "external"}">Uninstall</button>
      </div>`;
  } else if (installed) {
    actionBtn = `<button class="btn-installed" disabled>✓ Installed</button>`;
  } else {
    actionBtn = `<button class="btn-install"
      data-id="${app.id}"
      data-url="${app.downloadUrl || ""}"
      data-name="${app.name}"
      data-type="${app.type || "external"}"
      data-appurl="${app.url || ""}"
      data-contenttype="${app.contentType || "sfw"}">Install</button>`;
  }

  return `
    <div class="app-card" data-id="${app.id}">
      ${banner}
      <div class="app-card-body">
        <div class="app-card-top">
          ${icon}
          <div class="app-info">
            <div class="app-name">${app.name}</div>
            <div class="app-meta">
              <span class="app-tag tag-${isNsfw ? "nsfw" : category}">${isNsfw ? "18+" : category}</span>
              ${app.version ? `<span class="app-tag tag-version">${app.version}</span>` : ""}
            </div>
          </div>
        </div>
        <p class="app-desc">${app.description || ""}</p>
      </div>
      <div class="app-card-footer">
        <span class="app-author">${app.author || ""}</span>
        ${actionBtn}
      </div>
    </div>`;
}

function buildExternalCard(app) {
  const name   = app.name || app.id;
  const initia = name[0]?.toUpperCase() || "?";
  return `
    <div class="app-card" data-id="${app.id}">
      <div class="app-card-banner-placeholder">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9"/></svg>
      </div>
      <div class="app-card-body">
        <div class="app-card-top">
          <div class="app-icon-placeholder">${initia}</div>
          <div class="app-info">
            <div class="app-name">${name}</div>
            <div class="app-meta"><span class="app-tag tag-tools">external</span></div>
          </div>
        </div>
        <p class="app-desc">${app.url || ""}</p>
      </div>
      <div class="app-card-footer">
        <span class="app-author">External App</span>
        <button class="btn-uninstall" data-id="${app.id}" data-name="${name}" data-external="true">Uninstall</button>
      </div>
    </div>`;
}

function attachCardListeners(grid) {
  grid.querySelectorAll(".btn-install").forEach(btn => btn.addEventListener("click", () => installApp(btn)));
  grid.querySelectorAll(".btn-uninstall").forEach(btn => btn.addEventListener("click", () => uninstallApp(btn)));
  grid.querySelectorAll(".btn-update-app").forEach(btn => btn.addEventListener("click", () => updateApp(btn)));
}

async function installApp(btn) {
  const id          = btn.dataset.id;
  const downloadUrl = btn.dataset.url;
  const name        = btn.dataset.name;
  const type        = btn.dataset.type || "external";
  const appUrl      = btn.dataset.appurl || "";
  const contentType = btn.dataset.contenttype || "sfw";

  if (!downloadUrl) { toast(`No download URL for ${name}`, "error"); return; }

  btn.disabled = true;
  btn.textContent = "Installing…";
  toast(`Installing ${name}…`, "info");

  try {
    let result;
    if (type === "official") {
      result = await window.backendAPI.install(id, downloadUrl);
    } else {
      result = await window.backendAPI.installExternal(id, downloadUrl, name, appUrl, contentType);
    }

    if (!result?.success) throw new Error(result?.error || "Install failed");

    installedIds.add(id);
    updateInstalledCount();
    toast(`✓ ${name} installed successfully!`, "success", 4000);
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    toast(`Failed to install ${name}: ${err.message}`, "error");
    btn.disabled = false;
    btn.textContent = "Install";
  }
}

async function updateApp(btn) {
  const id          = btn.dataset.id;
  const downloadUrl = btn.dataset.url;
  const name        = btn.dataset.name;
  const type        = btn.dataset.type || "external";
  const appUrl      = btn.dataset.appurl || "";
  const contentType = btn.dataset.contenttype || "sfw";

  if (!downloadUrl) { toast(`No download URL for ${name}`, "error"); return; }

  btn.disabled = true;
  btn.textContent = "Updating…";
  toast(`Updating ${name}…`, "info");

  try {
    const result = type === "official"
      ? await window.backendAPI.install(id, downloadUrl)
      : await window.backendAPI.installExternal(id, downloadUrl, name, appUrl, contentType);

    if (!result?.success) throw new Error(result?.error || "Update failed");

    toast(`✓ ${name} updated successfully!`, "success", 4000);
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    toast(`Failed to update ${name}: ${err.message}`, "error");
    btn.textContent = "Update";
    btn.disabled = false;
  }
}

async function uninstallApp(btn) {
  const id         = btn.dataset.id;
  const name       = btn.dataset.name;
  const isExternal = btn.dataset.external === "true" || (btn.dataset.type || "external") === "external";

  if (!confirm(`Uninstall ${name}? This will delete all its files.`)) return;

  btn.disabled = true;
  btn.textContent = "Stopping…";
  toast(`Stopping ${name}…`, "info");

  try {

    try { await window.backendAPI.killOrphanNodes(); } catch (_) {}
    await new Promise(r => setTimeout(r, 1500));

    btn.textContent = "Removing…";

    const result = isExternal
      ? await window.backendAPI.uninstallExternal(id)
      : await window.backendAPI.uninstall(id);

    installedIds.delete(id);
    if (isExternal) externalApps = externalApps.filter(a => a.id !== id);

    if (result?.success) {
      toast(`✓ ${name} was successfully uninstalled.`, "success", 4000);
    } else {
      toast(`${name} has been removed from your library. Some files may remain on disk.`, "warn", 5000);
    }
    setTimeout(() => window.location.reload(), 1500);

  } catch (err) {
    toast(`Failed to uninstall ${name}: ${err.message}`, "error");
    btn.disabled = false;
    btn.textContent = "Uninstall";
  }
}

let launcherChecked = false;

function getOsAsset(assets) {
  const platform = window.navigator.platform.toLowerCase();
  const ua       = window.navigator.userAgent.toLowerCase();
  let ext;
  if (platform.startsWith("win") || ua.includes("windows")) ext = ".exe";
  else if (platform.startsWith("mac") || ua.includes("mac"))  ext = ".dmg";
  else                                                          ext = ".AppImage";
  return assets.find(a => a.name.endsWith(ext)) || null;
}

async function checkLauncherUpdate() {
  if (launcherChecked) return;
  launcherChecked = true;

  const statusEl  = document.getElementById("launcher-status");
  const currentEl = document.getElementById("current-version");
  const latestEl  = document.getElementById("latest-version");
  const updateBtn = document.getElementById("btn-launcher-update");
  const badge     = document.getElementById("launcher-update-badge");
  const changelog = document.getElementById("btn-changelog");

  currentEl.textContent = CURRENT_VERSION;

  try {
    const res = await fetch(`https://api.github.com/repos/${LAUNCHER_REPO}/releases/latest`);
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const release = await res.json();

    const latest = release.tag_name || "unknown";
    latestEl.textContent = latest;
    changelog.href = release.html_url || "#";

    if (latest === CURRENT_VERSION) {
      statusEl.className = "launcher-status up-to-date";
      statusEl.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:14px;height:14px;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>
        <span>Atlas Launcher is up to date</span>`;
      return;
    }

    const asset = getOsAsset(release.assets || []);
    if (!asset) {
      statusEl.className = "launcher-status error";
      statusEl.innerHTML = `<span>Update available (${latest}) but no installer found for your OS.</span>`;
      return;
    }

    const platform = window.navigator.platform.toLowerCase();
    const osLabel  = platform.startsWith("win") ? "Windows" : platform.startsWith("mac") ? "macOS" : "Linux";

    statusEl.className = "launcher-status has-update";
    statusEl.innerHTML = `<div class="spinner-sm"></div><span>Update available — ${latest} · ${osLabel} (${asset.name})</span>`;
    updateBtn.disabled = false;
    badge.classList.remove("hidden");
    document.getElementById("update-badge-text").textContent = `Launcher ${latest} available`;

    updateBtn.addEventListener("click", async () => {
      updateBtn.disabled = true;
      updateBtn.textContent = "Downloading…";
      statusEl.innerHTML = `<div class="spinner-sm"></div><span>Downloading ${asset.name}…</span>`;
      toast(`Downloading ${asset.name}…`, "info", 8000);

      try {
        const result = await window.backendAPI.updateLauncher(asset.browser_download_url, asset.name);
        if (!result?.success) throw new Error(result?.error || "Update failed");
        toast("Installer downloaded — run it to apply the update.", "success", 8000);
        statusEl.className = "launcher-status up-to-date";
        statusEl.innerHTML = `<span>Installer saved to Downloads — run it to complete the update.</span>`;
        badge.classList.add("hidden");
      } catch (err) {
        toast("Launcher update failed: " + err.message, "error");
        updateBtn.disabled = false;
        updateBtn.textContent = "Update Launcher";
      }
    }, { once: true });

  } catch (err) {
    console.error("Launcher update check failed:", err);
    statusEl.className = "launcher-status error";
    statusEl.innerHTML = `<span>Could not check for updates. Try again later.</span>`;
    latestEl.textContent = "—";
  }
}

(async () => {
  document.getElementById("browse-grid").innerHTML = `
    <div class="grid-loading">
      <div class="spinner"></div>
      <p>Fetching registry…</p>
    </div>`;
  await loadRegistry();
})();
