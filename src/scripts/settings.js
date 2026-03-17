const nsfwToggle = document.getElementById("nsfw-toggle");
const externalToggle = document.getElementById("externalSRCS-toggle");
const navApps = document.getElementById("nav-apps");
const externalDivider = document.getElementById("divider");

const updateExternalVisibility = (isVisible) => {
  if (navApps) {
    navApps.style.display = isVisible ? "flex" : "none";
  }
  if (externalDivider) {
    externalDivider.style.display = isVisible ? "block" : "none";
  }
};

window.addEventListener("DOMContentLoaded", () => {
  nsfwToggle.checked = localStorage.getItem("contentType") === "nsfw";

  const isExternalActive = localStorage.getItem("showExternal") === "true";
  if (externalToggle) externalToggle.checked = isExternalActive;
  updateExternalVisibility(isExternalActive);
});

nsfwToggle.addEventListener("change", () => {
  localStorage.setItem("contentType", nsfwToggle.checked ? "nsfw" : "sfw");
});

if (externalToggle) {
  externalToggle.addEventListener("change", () => {
    const isActive = externalToggle.checked;
    localStorage.setItem("showExternal", isActive);
    updateExternalVisibility(isActive);
    location.reload();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".nav-tab-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const targetId = e.currentTarget.dataset.target;
      if (!targetId) return;
      document
        .querySelectorAll(".settings-section")
        .forEach((s) => s.classList.add("hidden"));
      document.getElementById(targetId)?.classList.remove("hidden");
      document
        .querySelectorAll(".nav-tab-btn")
        .forEach((b) => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
    });
  });
});

const connectBtn = document.getElementById("connect-btn");
const unlinkBtn = document.getElementById("unlink-btn");
const oauthModal = document.getElementById("connect-modal");
const oauthModalBackdrop = document.querySelector(".oauth-modal-backdrop");
const modalClose = document.getElementById("modal-close");
const linkAccountBtn = document.getElementById("link-account-btn");
const oauthCancel = document.getElementById("oauth-cancel");

function updateAniListUI(username, avatar) {
  const usernameEl = document.getElementById("anilist-username");
  const avatarImg = document.getElementById("anilist-avatar");
  const defaultLogo = document.getElementById("anilist-default-logo");

  if (usernameEl) usernameEl.textContent = username;
  if (avatar && avatarImg && defaultLogo) {
    avatarImg.src = avatar;
    avatarImg.style.display = "block";
    defaultLogo.style.display = "none";
  }

  connectBtn.textContent = "Relink Account";
  connectBtn.classList.add("connected");
  if (unlinkBtn) unlinkBtn.style.display = "inline-block";
}

function resetAniListUI() {
  const usernameEl = document.getElementById("anilist-username");
  const avatarImg = document.getElementById("anilist-avatar");
  const defaultLogo = document.getElementById("anilist-default-logo");

  if (usernameEl) usernameEl.textContent = "AniList";
  if (avatarImg) avatarImg.style.display = "none";
  if (defaultLogo) defaultLogo.style.display = "block";

  connectBtn.textContent = "Connect";
  connectBtn.classList.remove("connected");
  if (unlinkBtn) unlinkBtn.style.display = "none";
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const res = await fetch("http://localhost:3000/api/v1/anilist/me");
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        updateAniListUI(data.username, data.avatar);
      } else {
        resetAniListUI();
      }
    } else {
      resetAniListUI();
    }
  } catch (e) {
    console.warn("Could not load AniList account:", e.message);
    resetAniListUI();
  }
});

window.addEventListener("DOMContentLoaded", () => {
  if (sessionStorage.getItem("goToConnections") === "true") {
    sessionStorage.removeItem("goToConnections");
    setTimeout(() => {
      document
        .querySelectorAll(".settings-section")
        .forEach((s) => s.classList.add("hidden"));
      document.getElementById("connections")?.classList.remove("hidden");
      document
        .querySelectorAll(".nav-tab-btn")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelector('[data-target="connections"]')
        ?.classList.add("active");
    }, 500);
  }
});

async function unlinkAniListAccount() {
  try {
    const res = await fetch("http://localhost:3000/api/v1/anilist/unlink", {
      method: "DELETE",
    });
    if (res.ok) {
      resetAniListUI();
      console.log("✅ AniList account unlinked");
    } else {
      console.error("Unlink failed:", await res.text());
    }
  } catch (e) {
    console.error("Unlink error:", e.message);
  }
}

if (unlinkBtn) {
  unlinkBtn.addEventListener("click", () => {
    if (confirm("Are you sure you want to unlink your AniList account?")) {
      unlinkAniListAccount();
    }
  });
}

connectBtn.addEventListener("click", () =>
  oauthModal.classList.remove("hidden"),
);

const closeOAuthModal = () => oauthModal.classList.add("hidden");
modalClose.addEventListener("click", closeOAuthModal);
oauthCancel.addEventListener("click", closeOAuthModal);
oauthModal.addEventListener("click", (e) => {
  if (e.target === oauthModalBackdrop || e.target === oauthModal)
    closeOAuthModal();
});

linkAccountBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("http://localhost:3000/api/v1/anilist/authorize");
    const data = await res.json();

    sessionStorage.setItem("goToConnections", "true");

    if (window.electronAPI?.openAniListOAuth) {
      window.electronAPI.openAniListOAuth(data.authUrl);
    } else {
      window.open(data.authUrl, "_blank");
    }

    closeOAuthModal();

    const poll = setInterval(async () => {
      try {
        const check = await fetch("http://localhost:3000/api/v1/anilist/me");
        if (check.ok) {
          const d = await check.json();
          if (d.success) {
            clearInterval(poll);
            window.location.reload();
          }
        }
      } catch {}
    }, 1000);

    setTimeout(() => clearInterval(poll), 3 * 60 * 1000);
  } catch (e) {
    console.error("OAuth error:", e);
    alert("Failed to start OAuth: " + e.message);
  }
});
