document.addEventListener("DOMContentLoaded", () => {
  const launchBtn = document.querySelector(".download");
  if (!launchBtn) return;

  let isAppOpen = false;

  function getAppName() {
    return launchBtn.textContent.trim().replace(/^(Launch|Close)\s*/i, "").trim();
  }

  function updateStatus(status) {
    const name = getAppName();
    launchBtn.disabled = false;
    if (status) {
      launchBtn.innerText = `Close ${name}`;
      launchBtn.style.backgroundColor = "#ff4444";
      launchBtn.style.color = "white";
    } else {
      launchBtn.innerText = `Launch ${name}`;
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
    const contentType = localStorage.getItem("contentType") || "sfw";

    if (!currentUrl || currentUrl === "null") {
      console.error("URL is missing from the button attribute!");
      return;
    }

    try {
      window.backendAPI.openApp({
        url: currentUrl,
        headers: secretKey
          ? { "x-secret-key": secretKey, "x-content-type": contentType }
          : {},
      });
    } catch (error) {
      console.error("IPC Error:", error);
      launchBtn.innerText = "An error occured when attempting to open this app.";
      setTimeout(() => updateStatus(false), 3000);
    }
  });
});
