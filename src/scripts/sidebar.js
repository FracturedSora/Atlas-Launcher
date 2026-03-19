document.addEventListener("DOMContentLoaded", async () => {
  const sidebarContainer = document.getElementById("sidebar");
  if (!sidebarContainer) return;

  const showExternal = localStorage.getItem("showExternal") === "true";
  const contentType  = localStorage.getItem("contentType") || "sfw";

  const allowNsfw    = contentType === "nsfw";

  const currentPage   = window.location.pathname.split("/").pop() || "";
  const currentParams = new URLSearchParams(window.location.search);
  const currentAppId  = currentParams.get("id") || "";

  function isActive(href) {
    return currentPage === href ? "active" : "";
  }

  function isActiveExternal(appId) {
    return currentPage === "externalapp.html" && currentAppId === appId ? "active" : "";
  }

  let externalHTML = "";
  if (showExternal) {
    try {
      const apps = await window.backendAPI.getExternalApps();

      if (apps?.length) {

        const filtered = apps.filter(app => {
          const appType = (app.contentType || "sfw").toLowerCase();
          if (appType === "nsfw" && !allowNsfw) return false;
          return true;
        });

        if (filtered.length) {
          const appIcons = filtered.map(app => {
            const domain     = new URL(app.url).hostname;
            const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
            const isNsfw     = (app.contentType || "sfw").toLowerCase() === "nsfw";

            return `
              <a href="externalapp.html?id=${encodeURIComponent(app.id)}"
                 class="nav-item external-app ${isActiveExternal(app.id)}${isNsfw ? " nsfw-app" : ""}"
                 title="${app.name}"
                 data-tooltip="${app.name}${isNsfw ? " (18+)" : ""}">
                <div class="nav-icon">
                  <img src="${faviconUrl}" alt="${app.name}" />
                </div>
              </a>
            `;
          }).join("");

          externalHTML = `
            <div class="nav-divider"></div>
            <div class="nav-group external-group">
              ${appIcons}
            </div>
          `;
        }
      }
    } catch (_) {}
  }

  sidebarContainer.innerHTML = `
    <aside class="atlas-sidebar">
      <nav class="atlas-nav">

        <div class="nav-group">
          <a href="home.html" class="nav-item ${isActive("home.html")}" data-tooltip="Home">
            <div class="nav-icon">
              <img src="../../public/icons/house.svg" alt="Home" />
            </div>
          </a>
          <a href="marketplace.html" class="nav-item ${isActive("marketplace.html")}" data-tooltip="Marketplace">
            <div class="nav-icon">
              <img src="../../public/icons/marketplace.svg" alt="Marketplace" />
            </div>
          </a>
        </div>

        <div class="nav-divider"></div>

        <div class="nav-group pinned-group">
          <a href="waifuanime.html" class="nav-item pinned ${isActive("waifuanime.html")}" data-tooltip="WaifuAnime">
            <div class="nav-icon"><img src="../../public/logos/blue.ico" alt="WaifuAnime" /></div>
            <div class="nav-pip"></div>
          </a>
          <a href="waifumanga.html" class="nav-item pinned ${isActive("waifumanga.html")}" data-tooltip="WaifuManga">
            <div class="nav-icon"><img src="../../public/logos/orange.ico" alt="WaifuManga" /></div>
            <div class="nav-pip"></div>
          </a>
          <a href="waifuboard.html" class="nav-item pinned ${isActive("waifuboard.html")}" data-tooltip="WaifuBoard">
            <div class="nav-icon"><img src="../../public/logos/green.ico" alt="WaifuBoard" /></div>
            <div class="nav-pip"></div>
          </a>
        </div>

        ${externalHTML}

        <div class="nav-spacer"></div>
        <div class="nav-divider"></div>

        <div class="nav-group">
          <a href="settings.html" class="nav-item ${isActive("settings.html")}" data-tooltip="Settings">
            <div class="nav-icon"><img src="../../public/icons/settings.svg" alt="Settings" /></div>
          </a>
        </div>

      </nav>
    </aside>
  `;

  sidebarContainer.querySelectorAll(".nav-item").forEach((el, i) => {
    el.style.animationDelay = `${i * 40}ms`;
    el.classList.add("nav-item--animate");
  });
});
