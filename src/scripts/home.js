(async () => {

  function updateClock() {
    const now = new Date();
    const h = now.getHours();
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const dateStr = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    document.getElementById("greeting-time").textContent = `${timeStr} · ${dateStr}`;
    const greeting =
      h < 5  ? "Still up?"      :
      h < 12 ? "Good Morning"   :
      h < 17 ? "Good Afternoon" :
      h < 21 ? "Good Evening"   : "Good Night";
    document.getElementById("greeting-text").innerHTML = `${greeting}, <span>Senpai</span>`;
    document.getElementById("stat-date").textContent =
      now.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  updateClock();
  setInterval(updateClock, 1000);

  function getCurrentSeason() {
    const m = new Date().getMonth();
    const y = new Date().getFullYear();
    const s = m < 3 ? "WINTER" : m < 6 ? "SPRING" : m < 9 ? "SUMMER" : "FALL";
    const label = s[0] + s.slice(1).toLowerCase() + " " + y;
    return { season: s, year: y, label };
  }
  const { season, year, label } = getCurrentSeason();
  document.getElementById("season-label").textContent = label;

  const pill = document.getElementById("adblocker-status");
  if (typeof window.backendAPI !== "undefined") {
    pill.classList.add("active");
    pill.querySelector("span").textContent = "Ad Blocker On";
  } else {
    pill.querySelector("span").textContent = "Ad Blocker Off";
  }

  const CACHE_TTL = 16 * 60 * 1000;

  function cacheSet(key, data) {
    try {
      sessionStorage.setItem("hp_" + key, JSON.stringify({ data, expires: Date.now() + CACHE_TTL }));
    } catch (_) {}
  }

  function cacheGet(key) {
    try {
      const raw = sessionStorage.getItem("hp_" + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() < entry.expires) return entry.data;
      sessionStorage.removeItem("hp_" + key);
    } catch (_) {}
    return null;
  }

  async function anilist(query, variables = {}) {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) throw new Error(`AniList error ${res.status}`);
    return res.json();
  }

  const MEDIA_FIELDS = `
    id
    title { english romaji }
    coverImage { large medium }
    bannerImage
    description(asHtml: false)
    episodes
    score: averageScore
    genres
    format
    status
    season
    seasonYear
  `;

  const Q_SEASONAL = `
    query ($season: MediaSeason, $year: Int) {
      Page(page: 1, perPage: 25) {
        media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;

  const Q_AIRING_TODAY = `
    query {
      Page(page: 1, perPage: 20) {
        airingSchedules(airingAt_greater: 0, sort: TIME, notYetAired: false) {
          episode
          media {
            ${MEDIA_FIELDS}
          }
        }
      }
    }
  `;

  const Q_TOP_AIRING = `
    query {
      Page(page: 1, perPage: 10) {
        media(type: ANIME, status: RELEASING, sort: SCORE_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;

  async function fetchSeasonal() {
    const key = `seasonal_${season}_${year}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const json = await anilist(Q_SEASONAL, { season, year });
    const data = json?.data?.Page?.media || [];
    cacheSet(key, data);
    return data;
  }

  async function fetchAiringToday() {

    const key = `airing_today_${new Date().toDateString()}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const json = await anilist(Q_AIRING_TODAY);
    const schedules = json?.data?.Page?.airingSchedules || [];
    const now = Date.now() / 1000;
    const cutoff = now - 86400;

    const seen = new Set();
    const data = schedules
      .filter(s => s.media && !seen.has(s.media.id) && seen.add(s.media.id))
      .map(s => ({ ...s.media, latestEpisode: s.episode }));
    cacheSet(key, data);
    return data;
  }

  async function fetchTopAiring() {
    const key = `top_airing_${new Date().toDateString()}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const json = await anilist(Q_TOP_AIRING);
    const data = json?.data?.Page?.media || [];
    cacheSet(key, data);
    return data;
  }

  function scoreStr(s) {
    return s ? (s / 10).toFixed(1) : "N/A";
  }

  function fmtTitle(m) {
    return m?.title?.english || m?.title?.romaji || "Unknown";
  }

  function cleanSynopsis(s) {
    return (s || "")
      .replace(/\n/g, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/\[Written by.*?\]/g, "")
      .trim() || "No synopsis available.";
  }

  try {
    const [seasonal, airingToday, topAiring] = await Promise.all([
      fetchSeasonal(),
      fetchAiringToday(),
      fetchTopAiring()
    ]);

    document.getElementById("stat-season").textContent = seasonal.length + "+";
    document.getElementById("stat-today").textContent = airingToday.length;
    if (topAiring[0]?.score) {
      document.getElementById("stat-topscore").textContent = scoreStr(topAiring[0].score);
    }

    const heroItems = seasonal
      .filter(a => a.bannerImage || a.coverImage?.large)
      .slice(0, 8);

    let heroIdx = 0;
    let heroTimer;

    const heroBg       = document.getElementById("hero-bg");
    const heroTitle    = document.getElementById("hero-title");
    const heroMeta     = document.getElementById("hero-meta");
    const heroSynopsis = document.getElementById("hero-synopsis");
    const heroDots     = document.getElementById("hero-dots");

    heroDots.innerHTML = heroItems
      .map((_, i) => `<div class="hero-dot ${i === 0 ? "active" : ""}" data-i="${i}"></div>`)
      .join("");

    heroDots.querySelectorAll(".hero-dot").forEach(d => {
      d.addEventListener("click", () => { clearInterval(heroTimer); setHero(+d.dataset.i); startTimer(); });
    });

    function setHero(idx) {
      heroIdx = idx;
      const a = heroItems[idx];
      if (!a) return;

      heroBg.classList.remove("skeleton");
      heroBg.style.backgroundImage = `url('${a.bannerImage || a.coverImage.large}')`;

      heroTitle.classList.remove("skeleton");
      heroTitle.style = "";
      heroTitle.textContent = fmtTitle(a);

      heroMeta.innerHTML = `
        <span class="hero-score">★ ${scoreStr(a.score)}</span>
        <span>· ${a.format || "TV"}</span>
        <span>· ${a.episodes ? a.episodes + " eps" : "Ongoing"}</span>
        ${(a.genres || []).slice(0, 2).map(g => `<span>· ${g}</span>`).join("")}
      `;

      heroSynopsis.classList.remove("skeleton");
      heroSynopsis.style = "";
      heroSynopsis.textContent = cleanSynopsis(a.description);

      heroDots.querySelectorAll(".hero-dot").forEach((d, i) => {
        d.classList.toggle("active", i === idx);
      });
    }

    function startTimer() {
      heroTimer = setInterval(() => {
        setHero((heroIdx + 1) % heroItems.length);
      }, 6000);
    }

    setHero(0);
    startTimer();

    document.getElementById("hero-prev").addEventListener("click", () => {
      clearInterval(heroTimer);
      setHero((heroIdx - 1 + heroItems.length) % heroItems.length);
      startTimer();
    });
    document.getElementById("hero-next").addEventListener("click", () => {
      clearInterval(heroTimer);
      setHero((heroIdx + 1) % heroItems.length);
      startTimer();
    });

    const airingCount = document.getElementById("airing-count");
    const airingList  = document.getElementById("airing-list");
    airingCount.textContent = airingToday.length;

    if (!airingToday.length) {
      airingList.innerHTML = `
        <div class="panel-item" style="color:var(--text-muted);font-size:12px;justify-content:center;padding:20px;">
          Nothing airing today
        </div>`;
    } else {
      airingList.innerHTML = airingToday.map(a => `
        <div class="panel-item">
          <img class="panel-item-img" src="${a.coverImage?.medium || ""}" alt="" loading="lazy" />
          <div class="panel-item-info">
            <div class="panel-item-title">${fmtTitle(a)}</div>
            <div class="panel-item-sub">
              <span class="ep-badge">EP ${a.latestEpisode || "?"}</span>
              <span>${a.score ? "★ " + scoreStr(a.score) : "Unscored"}</span>
            </div>
          </div>
        </div>
      `).join("");
    }

    const topCount = document.getElementById("top-count");
    const topList  = document.getElementById("top-list");
    topCount.textContent = topAiring.length;

    topList.innerHTML = topAiring.map((a, i) => `
      <div class="rank-item">
        <div class="rank-num ${i < 3 ? "top" : ""}">${i + 1}</div>
        <img class="rank-img" src="${a.coverImage?.medium || ""}" alt="" loading="lazy" />
        <div class="rank-info">
          <div class="rank-title">${fmtTitle(a)}</div>
          <div class="rank-score">★ ${scoreStr(a.score)}</div>
        </div>
      </div>
    `).join("");

  } catch (err) {
    console.error("Home portal error:", err);
  }

})();
