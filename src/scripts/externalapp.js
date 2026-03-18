document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const appId = params.get("id");
  if (!appId) return;

  const apps = await window.backendAPI.getExternalApps();
  const app = apps.find(a => a.id === appId);
  if (!app) return;

  document.title = `Atlas Launcher | ${app.name}`;

  const banner = document.getElementById("app-banner");
  const btn = document.getElementById("launch-btn");

  banner.src = `${app.bannerPath}`;
  btn.textContent = `Launch ${app.name}`;
  btn.setAttribute("data-url", app.url);
});
