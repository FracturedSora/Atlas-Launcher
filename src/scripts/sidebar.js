document.addEventListener("DOMContentLoaded", () => {
  const sidebarContainer = document.getElementById("sidebar");
  if (!sidebarContainer) return;

  const showExternal = localStorage.getItem("showExternal") === "true";

  const appsSection = showExternal ? `
      <div class="divider"></div>
      <div class="nav-apps">
          <a href="animekai.html" class="app">
              <img src="../../public/logos/animekai.png" />
          </a>
      </div>
  ` : `<div class="nav-apps"> </div>`;

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
