document.addEventListener("DOMContentLoaded", () => {
  const launchBtn = document.querySelector(".download");
  if (!launchBtn) return;

  let isAppOpen = false;
  const appName = launchBtn.textContent.trim();
  const cleanAppName = appName.replace(/Launch|Close/g, "").trim();

  function updateStatus(status) {
    launchBtn.disabled = false;
    if (status) {
      launchBtn.innerText = "Close " + cleanAppName;
      launchBtn.style.backgroundColor = "#ff4444";
      launchBtn.style.color = "white";
    } else {
      launchBtn.innerText = "Launch " + cleanAppName;
      launchBtn.style.backgroundColor = "";
      launchBtn.style.color = "";
    }
  }

  window.backendAPI.status((data) => {
    isAppOpen = data.status === "open";
    updateStatus(isAppOpen);
  });

  launchBtn.addEventListener("click", () => {
    const currentUrl = String(launchBtn.getAttribute("data-url") || "");
    const secretKey = launchBtn.getAttribute("data-key");

    if (!currentUrl || currentUrl === "null") {
      console.error("URL is missing from the button attribute!");
      return;
    }

    try {
      window.backendAPI.openApp({
        url: currentUrl,
        headers: secretKey ? { "x-secret-key": secretKey } : {}
      });
    } catch (error) {
      console.error("IPC Error:", error);
      launchBtn.innerText =
        "An error occured when attempting to open this app.";
      setTimeout(() => updateStatus(false), 3000);
    }
  });
});
