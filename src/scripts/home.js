(async () => {
  function updateClock() {
    const now = new Date();
    const h = now.getHours();
    const timeStr = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const dateStr = now.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    document.getElementById("greeting-time").textContent =
      `${timeStr} · ${dateStr}`;
    const greeting =
      h < 5
        ? "Still up?"
        : h < 12
          ? "Good Morning"
          : h < 17
            ? "Good Afternoon"
            : h < 21
              ? "Good Evening"
              : "Good Night";
    document.getElementById("greeting-text").innerHTML =
      `${greeting}, <span>Senpai</span>`;
    document.getElementById("stat-date").textContent = now.toLocaleDateString(
      [],
      { month: "short", day: "numeric" },
    );
  }
  updateClock();
  setInterval(updateClock, 1000);

  function getCurrentSeason() {
    const m = new Date().getMonth();
    const y = new Date().getFullYear();
    const s = m < 3 ? "Winter" : m < 6 ? "Spring" : m < 9 ? "Summer" : "Fall";
    return { season: s.toLowerCase(), year: y, label: `${s} ${y}` };
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

  async function jikan(endpoint) {
    const res = await fetch(`https://api.jikan.moe/v4${endpoint}`);
    if (!res.ok) throw new Error(`Jikan ${endpoint} failed`);
    return res.json();
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  try {
    const days = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const todayDay = days[new Date().getDay()];

    const [seasonData, scheduledData, topData] = await Promise.all([
      jikan(`/seasons/${year}/${season}?limit=25`),
      delay(400).then(() => jikan(`/schedules?filter=${todayDay}&limit=20`)),
      delay(800).then(() => jikan(`/top/anime?filter=airing&limit=10`)),
    ]);

    const seasonal = seasonData.data || [];
    const scheduled = scheduledData.data || [];
    const top = topData.data || [];

    document.getElementById("stat-season").textContent = seasonal.length + "+";
    document.getElementById("stat-today").textContent = scheduled.length;
    if (top[0]?.score) {
      document.getElementById("stat-topscore").textContent =
        top[0].score.toFixed(1);
    }

    const heroItems = seasonal
      .filter((a) => a.images?.jpg?.large_image_url)
      .slice(0, 8);
    let heroIdx = 0;

    const heroBg = document.getElementById("hero-bg");
    const heroTitle = document.getElementById("hero-title");
    const heroMeta = document.getElementById("hero-meta");
    const heroSynopsis = document.getElementById("hero-synopsis");
    const heroDots = document.getElementById("hero-dots");

    heroDots.innerHTML = heroItems
      .map(
        (_, i) =>
          `<div class="hero-dot ${i === 0 ? "active" : ""}" data-i="${i}"></div>`,
      )
      .join("");
    heroDots.querySelectorAll(".hero-dot").forEach((d) => {
      d.addEventListener("click", () => setHero(+d.dataset.i));
    });

    function setHero(idx) {
      heroIdx = idx;
      const a = heroItems[idx];
      if (!a) return;

      heroBg.classList.remove("skeleton");
      heroBg.style.backgroundImage = `url('${a.images.jpg.large_image_url}')`;

      heroTitle.classList.remove("skeleton");
      heroTitle.style = "";
      heroTitle.textContent = a.title_english || a.title;

      heroMeta.innerHTML = `
                        <span class="hero-score">★ ${a.score || "N/A"}</span>
                        <span>· ${a.type || "TV"}</span>
                        <span>· ${a.episodes ? a.episodes + " eps" : "Ongoing"}</span>
                        ${
                          a.genres
                            ?.slice(0, 2)
                            .map((g) => `<span>· ${g.name}</span>`)
                            .join("") || ""
                        }
                    `;

      heroSynopsis.classList.remove("skeleton");
      heroSynopsis.style = "";
      heroSynopsis.textContent =
        a.synopsis?.replace(/\[Written by.*?\]/g, "").trim() ||
        "No synopsis available.";

      heroDots.querySelectorAll(".hero-dot").forEach((d, i) => {
        d.classList.toggle("active", i === idx);
      });
    }

    setHero(0);

    document.getElementById("hero-prev").addEventListener("click", () => {
      setHero((heroIdx - 1 + heroItems.length) % heroItems.length);
    });
    document.getElementById("hero-next").addEventListener("click", () => {
      setHero((heroIdx + 1) % heroItems.length);
    });

    setInterval(() => {
      setHero((heroIdx + 1) % heroItems.length);
    }, 6000);

    const airingCount = document.getElementById("airing-count");
    const airingList = document.getElementById("airing-list");
    airingCount.textContent = scheduled.length;
    document.getElementById("stat-today").textContent = scheduled.length;

    if (scheduled.length === 0) {
      airingList.innerHTML = `<div class="panel-item" style="color:var(--text-muted);font-size:12px;justify-content:center;padding:20px;">Nothing airing today</div>`;
    } else {
      airingList.innerHTML = scheduled
        .map(
          (a) => `
                        <div class="panel-item">
                            <img class="panel-item-img" src="${a.images?.jpg?.image_url || ""}" alt="" loading="lazy" />
                            <div class="panel-item-info">
                                <div class="panel-item-title">${a.title_english || a.title}</div>
                                <div class="panel-item-sub">
                                    <span class="ep-badge">EP ${a.episodes || "?"}</span>
                                    <span>${a.score ? "★ " + a.score : "Unscored"}</span>
                                </div>
                            </div>
                        </div>
                    `,
        )
        .join("");
    }

    const topCount = document.getElementById("top-count");
    const topList = document.getElementById("top-list");
    topCount.textContent = top.length;

    topList.innerHTML = top
      .map(
        (a, i) => `
                    <div class="rank-item">
                        <div class="rank-num ${i < 3 ? "top" : ""}">${i + 1}</div>
                        <img class="rank-img" src="${a.images?.jpg?.image_url || ""}" alt="" loading="lazy" />
                        <div class="rank-info">
                            <div class="rank-title">${a.title_english || a.title}</div>
                            <div class="rank-score">★ ${a.score || "N/A"}</div>
                        </div>
                    </div>
                `,
      )
      .join("");
  } catch (err) {
    console.error("Home portal data error:", err);
  }
})();
