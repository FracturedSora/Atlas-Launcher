document.addEventListener("DOMContentLoaded", async () => {
  const sidebarContainer = document.getElementById("sidebar");
  if (!sidebarContainer) return;

  const showExternal = localStorage.getItem("showExternal") === "true";

  let appsSection = `<div class="nav-apps"></div>`;

  if (showExternal) {
    const apps = await window.backendAPI.getExternalApps();

    const appIcons = apps.map(app => {
      const domain = new URL(app.url).hostname;
      const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
      return `
        <a href="externalapp.html?id=${encodeURIComponent(app.id)}" class="app external-app" title="${app.name}">
          <img src="${faviconUrl}" alt="${app.name}" />
        </a>
      `;
    }).join("");

    appsSection = `
      <div class="divider"></div>
      <div class="nav-apps">
        ${appIcons}
      </div>
    `;
  }

  sidebarContainer.innerHTML = `
    <aside class="aside">
      <nav>
        <a href="home.html" class="nav-bottom">
          <img src="../../public/icons/house.svg" />
        </a>
        <div class="divider"></div>
        <a href="waifuanime.html" class="pinned-item">
          <img src="../../public/logos/blue.ico" />
        </a>
        <a href="waifumanga.html" class="pinned-item">
          <img src="../../public/logos/orange.ico" />
        </a>
        <a href="waifuboard.html" class="pinned-item">
          <img src="../../public/logos/green.ico" />
        </a>
        ${appsSection}
        <div class="divider"></div>
        <a href="settings.html" class="nav-bottom">
          <img src="../../public/icons/settings.svg" />
        </a>
      </nav>
    </aside>
  `;
});
