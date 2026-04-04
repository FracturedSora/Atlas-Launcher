// Protocol Init
if (!localStorage.getItem("contentType")) {
  localStorage.setItem("contentType", "sfw");
}

// Global UI References (Assigned during Init)
let homeShelves, searchView, resultsContainer, searchBtn, searchBar;

// Hero State
let heroItems = [];
let currentHeroIndex = 0;
let heroInterval;

// --- NEW: Proxy URL Formatter ---
// Automatically injects the correct referer so MangaFire's CDN doesn't block the image
function getProxyUrl(rawUrl, sourceName) {
  if (!rawUrl) return "";
  let proxyUrl = `/api/proxy?url=${encodeURIComponent(rawUrl)}`;
  let referer = "";

  if (sourceName) {
    const s = sourceName.toLowerCase();
    if (s.includes("mangafire")) referer = "https://mangafire.to/";
    else if (s.includes("comix")) referer = "https://comix.to/";
  } else {
    referer = "https://anilist.co/"; // Default for standard AniList API results
  }

  if (referer) {
    proxyUrl += `&referer=${encodeURIComponent(referer)}`;
  }
  return proxyUrl;
}

// Carousel Scroll Logic
window.scrollTrack = function (trackId, amount) {
  const track = document.getElementById(trackId);
  if (track) {
    track.scrollBy({ left: amount, behavior: "smooth" });
  }
};

// --- Direct AniList Fetcher ---
async function fetchAnilistData(anilistId, title) {
  const query = `
    query ($id: Int, $search: String) {
      Media (id: $id, search: $search, type: MANGA) {
        id
        title {
          romaji
          english
          native
        }
        description
        coverImage {
          extraLarge
          large
        }
        bannerImage
        genres
        averageScore
        status
        format
        staff {
          edges {
            role
            node {
              name { full }
              image { large }
            }
          }
        }
        characters {
          edges {
            role
            node {
              name { full }
              image { large }
            }
          }
        }
      }
    }
  `;

  const variables = {};
  if (anilistId && !isNaN(anilistId)) {
    variables.id = parseInt(anilistId);
  } else if (title) {
    variables.search = title;
  } else {
    return null;
  }

  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) throw new Error("AniList response not OK");
    const json = await response.json();
    return json.data?.Media || null;
  } catch (error) {
    console.error("Direct AniList fetch failed:", error);
    return null;
  }
}

// Navigate to series page safely with fresh metadata
async function goToSeries(anilistId, title, item) {
  try {
    document.body.style.cursor = "wait";

    const currentLang = localStorage.getItem("language") || "en";
    let targetUrl = "";

    const aniListMeta = await fetchAnilistData(anilistId, title);

    const mergedData = {
      ...(item || {}),
      aniList: aniListMeta
    };

    // Make sure we carry the referer forward so the series page can use it too!
    if (item && item.sourceName && item.sourceName.toLowerCase().includes("mangafire")) {
        mergedData.referer = "https://mangafire.to/";
    }

    sessionStorage.setItem("pending_series_data", JSON.stringify(mergedData));

    const finalAnilistId = aniListMeta?.id || anilistId;

    if (finalAnilistId) {
      targetUrl = `/series/${encodeURIComponent(finalAnilistId)}?lang=${currentLang}`;
    } else if (item && item.id && item.sourceName) {
      const slug = encodeURIComponent(String(item.id));
      const src = encodeURIComponent(String(item.sourceName));
      targetUrl = `/series/${slug}?source=${src}&lang=${currentLang}`;
    } else if (title) {
      const slug = encodeURIComponent(String(title));
      targetUrl = `/series/${slug}?lang=${currentLang}`;
    } else {
      console.warn("goToSeries: Missing required parameters to route safely.");
      document.body.style.cursor = "default";
      return;
    }

    document.body.style.cursor = "default";
    window.location.href = targetUrl;
  } catch (err) {
    document.body.style.cursor = "default";
    console.error("Navigation error:", err);
  }
}

async function loadHome() {
  try {
    const response = await fetch("/api/home");
    const result = await response.json();

    if (result.success && result.data) {
      heroItems = result.data.trending.slice(0, 5);
      renderHero(currentHeroIndex);
      createHeroDots();
      startHeroCycle();

      populateTrack("track-trending", result.data.trending.slice(5));
      populateTrack("track-popular", result.data.popular);
      populateTrack("track-favorites", result.data.favorites);
    }
  } catch (err) {
    console.error("Failed to load home data:", err);
  }
}

function populateTrack(trackId, items) {
  const track = document.getElementById(trackId);
  if (!track || !items) return;
  track.innerHTML = "";

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "card";

    const rawImgUrl = item.coverImage?.large || "";
    const proxyImgUrl = getProxyUrl(rawImgUrl, null); // Null means standard AniList referer
    const title = item.title?.english || item.title?.romaji || "Unknown";
    const genre = item.genres?.length > 0 ? item.genres[0] : "Manga";

    card.innerHTML = `
            <img src="${proxyImgUrl}" alt="Cover" loading="lazy">
            <div class="card-info">
                <h3 class="card-title">${title}</h3>
                <p class="card-source">${genre}</p>
            </div>
        `;

    card.style.cursor = "pointer";
    card.addEventListener("click", () =>
      goToSeries(item.id, title, {
        id: item.id,
        title: title,
        thumb: rawImgUrl, // Keep raw URL in state to prevent double-proxying later
        type: "manga",
      })
    );
    track.appendChild(card);
  });
}

// Hero Logic
function renderHero(index) {
  const item = heroItems[index];
  if (!item) return;

  const title = item.title?.english || item.title?.romaji || "Unknown";
  const desc = item.description
    ? item.description.replace(/<[^>]*>?/gm, "")
    : "No description available.";

  const rawBannerUrl = item.bannerImage || item.coverImage?.extraLarge || "";
  const proxyBannerUrl = getProxyUrl(rawBannerUrl, null);

  const bgEl = document.getElementById("hero-bg");
  if (bgEl) bgEl.style.opacity = "0";

  setTimeout(() => {
    const titleEl = document.getElementById("hero-title");
    const descEl = document.getElementById("hero-desc");
    const badgeEl = document.getElementById("hero-badge");
    const tagsEl = document.getElementById("hero-tags");

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;
    if (badgeEl) badgeEl.textContent = `#${index + 1} Trending`;

    if (tagsEl && item.genres) {
        tagsEl.innerHTML = item.genres
        .slice(0, 3)
        .map((g) => `<span>${g}</span>`)
        .join(" • ");
    }

    if (bgEl) {
        bgEl.src = proxyBannerUrl;
        bgEl.style.opacity = "0.6";
    }

    updateDots(index);
  }, 300);

  const readBtn = document.querySelector(".primary-btn.glass-btn");
  if (readBtn) {
    const newBtn = readBtn.cloneNode(true);
    readBtn.parentNode.replaceChild(newBtn, readBtn);
    newBtn.addEventListener("click", () => goToSeries(item.id, title));
  }
}

function createHeroDots() {
  const container = document.getElementById("hero-dots");
  if (!container) return;

  container.innerHTML = "";
  heroItems.forEach((_, idx) => {
    const dot = document.createElement("div");
    dot.className = `dot ${idx === 0 ? "active" : ""}`;
    dot.onclick = () => {
      currentHeroIndex = idx;
      renderHero(currentHeroIndex);
      resetHeroCycle();
    };
    container.appendChild(dot);
  });
}

function updateDots(index) {
  document.querySelectorAll(".dot").forEach((dot, idx) => {
    dot.classList.toggle("active", idx === index);
  });
}

function nextHero() {
  if (heroItems.length === 0) return;
  currentHeroIndex = (currentHeroIndex + 1) % heroItems.length;
  renderHero(currentHeroIndex);
}

function prevHero() {
  if (heroItems.length === 0) return;
  currentHeroIndex = (currentHeroIndex - 1 + heroItems.length) % heroItems.length;
  renderHero(currentHeroIndex);
}

function startHeroCycle() {
  clearInterval(heroInterval);
  heroInterval = setInterval(nextHero, 7000);
}

function resetHeroCycle() {
  startHeroCycle();
}

// --- Search Logic ---
let searchTimeout;
let currentEventSource = null;
let trackIndex = 0;

function performSearch(query) {
  if (currentEventSource) {
    currentEventSource.close();
  }

  if (!query) {
    if (homeShelves) homeShelves.style.display = "block";
    if (searchView) searchView.style.display = "none";
    return;
  }

  if (homeShelves) homeShelves.style.display = "none";
  if (searchView) {
      searchView.style.display = "block";
      searchView.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  trackIndex = 0;
  let hasResults = false;

  if (resultsContainer) {
      resultsContainer.innerHTML = `
        <div class="loader-container" id="search-loader">
            <div class="spinner"></div>
            <p style="color: var(--text-dim);">Scanning Nexus extensions in parallel...</p>
        </div>
      `;
  }

  const contentType = localStorage.getItem("contentType");

  currentEventSource = new EventSource(
    `/api/search?q=${encodeURIComponent(query)}&contentType=${contentType}`
  );

  currentEventSource.onmessage = (event) => {
    hasResults = true;

    const loader = document.getElementById("search-loader");
    if (loader) loader.remove();

    try {
        const payload = JSON.parse(event.data);
        const sourceName = payload.sourceName;
        const items = payload.data;

        const section = document.createElement("section");
        section.className = "carousel-section";

        const trackId = `search-track-${trackIndex}`;
        trackIndex++;

        section.innerHTML = `
            <h3 class="section-title">
                <span style="color: var(--accent);">${sourceName}</span>
            </h3>
            <div class="carousel-wrapper">
                <button class="scroll-btn left" onclick="scrollTrack('${trackId}', -600)">❮</button>
                <div class="carousel-track" id="${trackId}"></div>
                <button class="scroll-btn right" onclick="scrollTrack('${trackId}', 600)">❯</button>
            </div>
        `;

        if (resultsContainer) resultsContainer.appendChild(section);

        const track = section.querySelector('.carousel-track');

        items.forEach((item) => {
            const card = document.createElement("div");
            card.className = "card";

            const rawImageUrl = item.thumb || item.image || "";
            const proxyImgUrl = getProxyUrl(rawImageUrl, sourceName); // Applies MangaFire referer here

            const displayTitle = item.title || "Unknown";
            const typeLabel = item.type === "novel" ? "Light Novel" : "Manga";

            card.innerHTML = `
                <img src="${proxyImgUrl}" alt="Cover" loading="lazy">
                <div class="card-info">
                    <h3 class="card-title">${displayTitle}</h3>
                    <p class="card-source">${typeLabel}</p>
                </div>
            `;

            card.style.cursor = "pointer";
            card.addEventListener("click", () => goToSeries(null, displayTitle, item));

            if (track) track.appendChild(card);
        });
    } catch (e) {
        console.error("Error processing search payload:", e);
    }
  };

  currentEventSource.addEventListener("end", () => {
    currentEventSource.close();

    const loader = document.getElementById("search-loader");
    if (loader) loader.remove();

    if (!hasResults && resultsContainer) {
      resultsContainer.innerHTML =
        '<div class="empty-state">No registry entries found across active extensions.</div>';
    }
  });

  currentEventSource.onerror = () => {
    currentEventSource.close();
  };
}

// --- App Initialization ---
const initApp = async () => {
  homeShelves = document.getElementById("home-shelves") || document.getElementById("home-view");
  searchView = document.getElementById("search-view");
  resultsContainer = document.getElementById("results");
  searchBtn = document.getElementById("search-btn");
  searchBar = document.getElementById("search-bar");

  const heroNext = document.getElementById("hero-next");
  const heroPrev = document.getElementById("hero-prev");

  if (heroNext) {
      heroNext.addEventListener("click", () => {
          nextHero();
          resetHeroCycle();
      });
  }

  if (heroPrev) {
      heroPrev.addEventListener("click", () => {
          prevHero();
          resetHeroCycle();
      });
  }

  if (searchBar) {
      searchBar.addEventListener("input", (e) => {
        const query = e.target.value.trim();
        clearTimeout(searchTimeout);

        if (!query) {
          if (homeShelves) homeShelves.style.display = "block";
          if (searchView) searchView.style.display = "none";
          if (resultsContainer) resultsContainer.innerHTML = "";
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }

        searchTimeout = setTimeout(() => {
          performSearch(query);
        }, 500);
      });

      searchBar.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          clearTimeout(searchTimeout);
          performSearch(searchBar.value.trim());
        }
      });
  }

  if (window.backendAPI?.getSettings) {
    try {
      const settings = await window.backendAPI.getSettings();
      if (settings?.language) {
        localStorage.setItem("language", settings.language);
      }
    } catch (e) {
      console.warn("Settings sync failed, using local storage fallback.");
    }
  }

  loadHome();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
