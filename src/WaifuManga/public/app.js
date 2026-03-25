// Protocol Init
if (!localStorage.getItem("contentType"))
  localStorage.setItem("contentType", "sfw");

// Target home-shelves so the Hero stays visible during search!
const homeShelves =
  document.getElementById("home-shelves") ||
  document.getElementById("home-view");
const searchView = document.getElementById("search-view");
const resultsContainer = document.getElementById("results");
const searchBtn = document.getElementById("search-btn");
const searchBar = document.getElementById("search-bar");

// Hero State
let heroItems = [];
let currentHeroIndex = 0;
let heroInterval;

// Carousel Scroll Logic
window.scrollTrack = function (trackId, amount) {
  const track = document.getElementById(trackId);
  track.scrollBy({ left: amount, behavior: "smooth" });
};

// Navigate to series page — prefers AniList ID, falls back to title slug
function goToSeries(anilistId, title, item) {
  if (anilistId) {
    window.location.href = `/series/${anilistId}`;
  } else if (item && item.id && item.sourceName) {
    // Extension result — use extension metadata, not AniList
    const slug = encodeURIComponent(item.id);
    const src = encodeURIComponent(item.sourceName);
    window.location.href = `/series/${slug}?source=${src}`;
  } else {
    const slug = encodeURIComponent(title);
    window.location.href = `/series/${slug}`;
  }
}

async function loadHome() {
  try {
    const response = await fetch("/api/home");
    const result = await response.json();

    if (result.success && result.data) {
      // Setup Hero (Top 5 Trending)
      heroItems = result.data.trending.slice(0, 5);
      renderHero(currentHeroIndex);
      createHeroDots();
      startHeroCycle();

      // Populate Tracks
      populateTrack("track-trending", result.data.trending.slice(5)); // Skip first 5 used in hero
      populateTrack("track-popular", result.data.popular);
      populateTrack("track-favorites", result.data.favorites);
    }
  } catch (err) {
    console.error("Failed to load home data:", err);
  }
}

function populateTrack(trackId, items) {
  const track = document.getElementById(trackId);
  track.innerHTML = "";

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "card";
    const imgUrl = item.coverImage.large;
    const title = item.title.english || item.title.romaji;
    const genre =
      item.genres && item.genres.length > 0 ? item.genres[0] : "Manga";

    card.innerHTML = `
            <img src="/api/proxy?url=${encodeURIComponent(imgUrl)}" alt="Cover" loading="lazy">
            <div class="card-info">
                <h3 class="card-title">${title}</h3>
                <p class="card-source">${genre}</p>
            </div>
        `;

    card.style.cursor = "pointer";
    card.addEventListener("click", () => goToSeries(item.id, title));
    track.appendChild(card);
  });
}

// Hero Logic
function renderHero(index) {
  const item = heroItems[index];
  if (!item) return;

  const title = item.title.english || item.title.romaji;
  const desc = item.description
    ? item.description.replace(/<[^>]*>?/gm, "")
    : "No description available.";
  const bannerUrl = item.bannerImage || item.coverImage.extraLarge;

  document.getElementById("hero-bg").style.opacity = "0";

  setTimeout(() => {
    document.getElementById("hero-title").textContent = title;
    document.getElementById("hero-desc").textContent = desc;
    document.getElementById("hero-badge").textContent =
      `#${index + 1} Trending`;
    document.getElementById("hero-tags").innerHTML = item.genres
      .slice(0, 3)
      .map((g) => `<span>${g}</span>`)
      .join(" • ");
    document.getElementById("hero-bg").src =
      `/api/proxy?url=${encodeURIComponent(bannerUrl)}`;
    document.getElementById("hero-bg").style.opacity = "0.6";
    updateDots(index);
  }, 300);

  // Make the Read Now button navigate to the series page
  const readBtn = document.querySelector(".primary-btn.glass-btn");
  if (readBtn) {
    readBtn.onclick = () => goToSeries(item.id, title);
  }
}

function createHeroDots() {
  const container = document.getElementById("hero-dots");
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
  currentHeroIndex = (currentHeroIndex + 1) % heroItems.length;
  renderHero(currentHeroIndex);
}

function prevHero() {
  currentHeroIndex =
    (currentHeroIndex - 1 + heroItems.length) % heroItems.length;
  renderHero(currentHeroIndex);
}

function startHeroCycle() {
  heroInterval = setInterval(nextHero, 7000);
}
function resetHeroCycle() {
  clearInterval(heroInterval);
  startHeroCycle();
}

document.getElementById("hero-next").addEventListener("click", () => {
  nextHero();
  resetHeroCycle();
});
document.getElementById("hero-prev").addEventListener("click", () => {
  prevHero();
  resetHeroCycle();
});

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
    searchView.style.display = "none";
    return;
  }

  if (homeShelves) homeShelves.style.display = "none";
  searchView.style.display = "block";
  searchView.scrollIntoView({ behavior: "smooth", block: "start" });

  // Reset UI
  trackIndex = 0;
  let hasResults = false;
  resultsContainer.innerHTML = `
    <div class="loader-container" id="search-loader">
        <div class="spinner"></div>
        <p style="color: var(--text-dim);">Scanning Nexus extensions in parallel...</p>
    </div>
  `;

  const contentType = localStorage.getItem("contentType");

  currentEventSource = new EventSource(
    `/api/search?q=${encodeURIComponent(query)}&contentType=${contentType}`,
  );

  currentEventSource.onmessage = (event) => {
    hasResults = true;

    const loader = document.getElementById("search-loader");
    if (loader) loader.remove();

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

    resultsContainer.appendChild(section);
    const track = document.getElementById(trackId);

    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "card";

      const rawImageUrl = item.thumb || item.image || "";
      const displayTitle = item.title || "Unknown";
      const typeLabel = item.type === "novel" ? "Light Novel" : "Manga";

      card.innerHTML = `
            <img src="/api/proxy?url=${encodeURIComponent(rawImageUrl)}" alt="Cover" loading="lazy">
            <div class="card-info">
                <h3 class="card-title">${displayTitle}</h3>
                <p class="card-source">${typeLabel}</p>
            </div>
        `;

      card.style.cursor = "pointer";
      // Navigate using the extension's own item ID and title
      card.addEventListener("click", () =>
        goToSeries(null, displayTitle, item),
      );
      track.appendChild(card);
    });
  };

  currentEventSource.addEventListener("end", () => {
    currentEventSource.close();

    const loader = document.getElementById("search-loader");
    if (loader) loader.remove();

    if (!hasResults) {
      resultsContainer.innerHTML =
        '<div class="empty-state">No registry entries found across active extensions.</div>';
    }
  });

  currentEventSource.onerror = () => {
    currentEventSource.close();
  };
}

// Live Search with Debounce
searchBar.addEventListener("input", (e) => {
  const query = e.target.value.trim();

  clearTimeout(searchTimeout);

  if (!query) {
    if (homeShelves) homeShelves.style.display = "block";
    searchView.style.display = "none";
    resultsContainer.innerHTML = "";
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

// Initialize
loadHome();
