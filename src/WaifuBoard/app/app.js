let activeScraper = null;
let currentPage = 1;
let currentQuery = "";
let isFetching = false;
let hasNextPage = true;
let currentFetchId = 0;

const grid = document.querySelector("main");
const searchInput = document.querySelector(".search-input");
const sentinel = document.createElement("div");
sentinel.id = "sentinel";
sentinel.style.height = "10px";
sentinel.style.gridColumn = "1 / -1";

// ── Source Logic ──────────────────────────────────────────────────────────────

function initSourcePicker() {
  const dropdown = document.getElementById("source-dropdown");

  // 1. Sync mode from URL param if present
  const urlParams = new URLSearchParams(window.location.search);
  const modeParam = urlParams.get("mode");

  if (modeParam) {
    localStorage.setItem("contentType", modeParam.toLowerCase());
    console.log("Syncing mode from launcher:", modeParam);
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({ path: newUrl }, "", newUrl);
  }

  // 2. Get current mode
  const contentType = (localStorage.getItem("contentType") || "sfw").toLowerCase();

  // 3. Filter extensions by mode
  const available = window.Nexus.extensions.filter((ext) => {
    if (contentType === "nsfw") return true;
    return ext.type === "sfw";
  });

  // 4. Rebuild dropdown UI
  dropdown.innerHTML = "";
  available.forEach((source) => {
    const item = document.createElement("div");
    item.className = "dropdown-item";
    item.innerHTML = `<img src="${source.icon}" width="16"><span>${source.name}</span>`;
    item.onclick = (e) => {
      e.stopPropagation();
      selectSource(source);
      dropdown.classList.remove("show");
    };
    dropdown.appendChild(item);
  });

  // 5. Always reselect a default when the list rebuilds.
  //    This ensures switching SFW<->NSFW picks an appropriate source.
  if (available.length > 0) {
    // Try to keep the current source if it's still in the allowed list
    const currentName = activeScraper?.name;
    const stillAvailable = currentName
      ? available.find((s) => s.name === currentName)
      : null;

    if (!stillAvailable) {
      // Current source was filtered out (e.g. switched to SFW) — pick a new default
      const def = available.find((s) => s.className === "Waifupics") || available[0];
      if (def) selectSource(def);
    }
    // If still available, leave it — no need to reload
  } else {
    // No sources available at all
    activeScraper = null;
    grid.innerHTML = `<div class="status">No sources available for this mode.</div>`;
  }
}

function updateContentMode(newMode) {
  localStorage.setItem("contentType", newMode);
  // Reset activeScraper so initSourcePicker always picks a fresh default
  activeScraper = null;
  initSourcePicker();
}

function selectSource(sourceObj) {
  isFetching = false;
  currentFetchId++;

  activeScraper = new sourceObj.classRef();
  activeScraper.name = sourceObj.name;

  const iconImg = document.getElementById("current-source-icon");
  iconImg.src = sourceObj.icon;
  iconImg.style.display = "block";

  currentPage = 1;
  hasNextPage = true;
  currentQuery = "";
  searchInput.value = "";

  loadGallery("", false);
  updateSidebarTags();
}

// ── Gallery ───────────────────────────────────────────────────────────────────

async function loadGallery(query = "", append = false) {
  if (!activeScraper || (!hasNextPage && append)) return;
  if (isFetching && append) return;

  isFetching = true;
  const fetchId = currentFetchId;
  currentQuery = query;

  if (!append) {
    currentPage = 1;
    grid.innerHTML = `<div class="status">Syncing with ${activeScraper.name}...</div>`;
    grid.scrollTo(0, 0);
  }

  try {
    const data = await activeScraper.search(query, currentPage);

    if (fetchId !== currentFetchId) return;

    if (data && data.results?.length > 0) {
      const fragment = document.createDocumentFragment();

      data.results.forEach((item) => {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
          <div class="img-loader-placeholder" style="background: #1a1a1a; aspect-ratio: 2/3;">
            <img src="${item.thumb}" loading="lazy" onload="this.parentElement.style.background='none'">
          </div>
          <div class="card-info">#${item.id}</div>
        `;
        card.onclick = () => openModal(item);
        fragment.appendChild(card);
      });

      if (!append) grid.innerHTML = "";
      grid.appendChild(fragment);

      currentPage++;
      hasNextPage = data.hasNext;
      grid.appendChild(sentinel);
    } else if (!append) {
      grid.innerHTML = `<div class="status">No results found on ${activeScraper.name}.</div>`;
    }
  } catch (e) {
    console.error("Gallery Error:", e);
    if (!append)
      grid.innerHTML = `<div class="status">Error connecting to source.</div>`;
  } finally {
    if (fetchId === currentFetchId) isFetching = false;
  }
}

async function updateSidebarTags() {
  if (!activeScraper || typeof activeScraper.getTrendingTags !== "function") return;
  const container = document.querySelector(".sidebar-section");
  if (!container) return;

  container.innerHTML = `<div class="sidebar-title">Trending</div><p class="status-mini" style="padding:10px; opacity:0.5;">Syncing...</p>`;

  try {
    const tags = await activeScraper.getTrendingTags();
    container.innerHTML = `<div class="sidebar-title">Trending</div>`;

    const fragment = document.createDocumentFragment();
    tags.forEach((tag) => {
      const tagEl = document.createElement("div");
      tagEl.className = "tag";
      tagEl.style.setProperty("--accent", `var(--tag-${tag.type || "general"}, #00aaff)`);

      const hasValidCount = tag.count && tag.count !== "API" && tag.count !== "";
      const displayCount = hasValidCount ? `<span class="count">${tag.count}</span>` : "";

      tagEl.innerHTML = `<span>${tag.name.replace(/_/g, " ")}</span>${displayCount}`;
      tagEl.onclick = () => {
        searchInput.value = tag.name;
        loadGallery(tag.name, false);
      };
      fragment.appendChild(tagEl);
    });
    container.appendChild(fragment);
  } catch (err) {
    container.innerHTML = `<div class="sidebar-title">Trending</div>`;
  }
}

// ── Modal ─────────────────────────────────────────────────────────────────────

async function openModal(item) {
  const modal = document.getElementById("nexus-modal");
  const modalImg = document.getElementById("modal-img");
  const tagCloud = document.getElementById("modal-tags");
  const commentFeed = document.getElementById("modal-comments");

  modal.style.display = "block";
  modalImg.src = item.thumb;
  modalImg.style.display = "block";
  modalImg.style.filter = "blur(15px) grayscale(50%)";

  tagCloud.innerHTML = "<span>Syncing metadata...</span>";
  commentFeed.innerHTML = "";

  try {
    const details = await activeScraper.getPostDetails(item.id);
    if (!details || !details.fullImage) {
      modalImg.style.filter = "none";
      return;
    }

    const proxiedUrl = `/proxy?url=${details.fullImage}`;
    const highRes = new Image();
    highRes.src = proxiedUrl;

    highRes.onload = () => {
      modalImg.src = proxiedUrl;
      modalImg.style.filter = "none";
    };

    highRes.onerror = () => {
      console.error("High-res load failed.");
      modalImg.style.filter = "none";
    };

    tagCloud.innerHTML = "";
    details.tags.forEach((t) => {
      const span = document.createElement("span");
      span.className = "res-badge";
      span.style.color = `var(--tag-${t.type || "general"}, var(--accent))`;
      span.innerText = t.name.replace(/_/g, " ");
      span.onclick = (e) => {
        e.stopPropagation();
        closeAndCleanup();
        searchInput.value = t.name;
        loadGallery(t.name, false);
      };
      tagCloud.appendChild(span);
    });

    commentFeed.innerHTML =
      details.comments?.length > 0
        ? details.comments
            .map(
              (c) => `
              <div class="comment-item">
                <b style="color:var(--accent)">${c.author}</b>
                <p>${c.body}</p>
              </div>`
            )
            .join("")
        : "<p style='opacity:0.5'>No comments found.</p>";
  } catch (e) {
    console.error("Scrape Error:", e);
    modalImg.style.filter = "none";
    tagCloud.innerHTML = "Error syncing.";
  }
}

function closeAndCleanup() {
  const modal = document.getElementById("nexus-modal");
  const video = document.getElementById("modal-video");
  if (video) {
    video.pause();
    video.src = "";
  }
  modal.style.display = "none";
}

// ── Listeners ─────────────────────────────────────────────────────────────────

document.querySelector(".close-modal").onclick = closeAndCleanup;

window.onclick = (e) => {
  if (e.target.id === "nexus-modal") closeAndCleanup();
  if (!e.target.closest(".source-picker")) {
    document.getElementById("source-dropdown").classList.remove("show");
  }
};

document.getElementById("active-source-display").onclick = (e) => {
  e.stopPropagation();
  document.getElementById("source-dropdown").classList.toggle("show");
};

searchInput.onkeypress = (e) => {
  if (e.key === "Enter") loadGallery(searchInput.value, false);
};

window.addEventListener("load", () => {
  setTimeout(initSourcePicker, 50);

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && !isFetching && hasNextPage)
        loadGallery(currentQuery, true);
    },
    { root: grid, rootMargin: "400px" }
  );
  observer.observe(sentinel);
});
