// ══════════════════════════════════════════════════════════════════════════════
// MY LIST — Fetches user AniList collection and renders categorized rails
// ══════════════════════════════════════════════════════════════════════════════

const _listData = {
  CURRENT: [],
  PLANNING: [],
  COMPLETED: [],
  PAUSED: []
};

let _currentUserId = null; // Tracked for cache invalidation

// ══════════════════════════════════════════════════════════════════════════════
// CACHE HELPERS
// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// CACHE — clear ONLY stale sessionStorage on every page load
// ══════════════════════════════════════════════════════════════════════════════
(function clearStaleCache() {
  try {
    const keys = Object.keys(sessionStorage);
    const now = Date.now();
    keys.forEach(k => {
      if (k.startsWith("as3_")) {
        try {
          const item = JSON.parse(sessionStorage.getItem(k));
          // If it's missing, malformed, or the expiration time has passed, delete it
          if (!item || !item.x || now > item.x) {
            sessionStorage.removeItem(k);
          }
        } catch (e) {
          sessionStorage.removeItem(k);
        }
      }
    });
  } catch (_) {}
})();

// 12 minutes = 720,000 ms
const TTL_12M = 720000;
const TTL = { trending: TTL_12M, popular: TTL_12M, top: TTL_12M, airing: TTL_12M, movies: TTL_12M, user: TTL_12M };
const _m  = {};

function cSet(k, d, ttl) {
  const e = { d, x: Date.now() + ttl };
  _m[k] = e;
  try { sessionStorage.setItem("as3_" + k, JSON.stringify(e)); } catch (_) {}
}

function cGet(k) {
  if (_m[k] && Date.now() < _m[k].x) return _m[k].d;
  try {
    const r = sessionStorage.getItem("as3_" + k);
    if (r) {
      const e = JSON.parse(r);
      if (Date.now() < e.x) { _m[k] = e; return e.d; }
      sessionStorage.removeItem("as3_" + k); // Delete if expired
    }
  } catch (_) {}
  return null;
}

function cRemove(k) {
  delete _m[k];
  try { sessionStorage.removeItem("as3_" + k); } catch (_) {}
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════════════════════
const px    = url => url ? `/api/v1/proxy?url=${encodeURIComponent(url)}` : "";
const ttl   = item => item.title.english || item.title.romaji || "Unknown";
const sc    = item => item.averageScore ? (item.averageScore / 10).toFixed(1) : null;
const epStr = item => item.episodes ? `${item.episodes} ep` : item.status === "RELEASING" ? "Ongoing" : null;

function synopsis2(raw, maxSentences = 2) {
  if (!raw) return "";
  const text      = raw.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const cut       = sentences.slice(0, maxSentences).join(" ").trim();
  return cut.length < text.length ? cut + "…" : cut;
}

function trailerUrl(trailer) {
  if (!trailer || trailer.site !== "youtube" || !trailer.id) return null;
  return `https://www.youtube.com/embed/${trailer.id}?autoplay=1&mute=1&loop=1&playlist=${trailer.id}&controls=0&modestbranding=1&rel=0&showinfo=0`;
}

// ══════════════════════════════════════════════════════════════════════════════
// HERO (Plan to Watch Carousel)
// ══════════════════════════════════════════════════════════════════════════════
let _heroItems = [];
let _heroIdx = 0;
let _heroTimer = null;

function buildHeroDots() {
  const c = document.getElementById("hero-progress");
  if (!c) return;
  c.innerHTML = "";
  _heroItems.forEach((_, i) => {
    const b = document.createElement("button");
    b.className = "h-dot" + (i === 0 ? " on" : "");
    b.onclick = () => goHero(i, true);
    c.appendChild(b);
  });
}

function syncHeroDots(i) {
  document.querySelectorAll(".h-dot").forEach((d, n) => d.classList.toggle("on", n === i));
}

function goHero(i, reset = false) {
  const item = _heroItems[i];
  if (!item) return;

  _heroIdx = i;
  const img = document.getElementById("hero-img");
  img.style.opacity = "0";
  setTimeout(() => { img.src = px(item.bannerImage || item.coverImage?.extraLarge); img.style.opacity = "1"; }, 280);

  document.getElementById("hero-title").textContent    = ttl(item);
  document.getElementById("hero-synopsis").textContent = synopsis2(item.description, 3);

  const score = sc(item), ep = epStr(item), yr = item.seasonYear;
  document.getElementById("hero-meta").innerHTML = [
    score ? `<span class="score">★ ${score}</span>` : "",
    yr    ? `<span class="sep">·</span><span>${yr}</span>` : "",
    ep    ? `<span class="sep">·</span><span>${ep}</span>` : "",
    ...(item.genres || []).slice(0, 2).map(g => `<span class="genre">${g}</span>`),
  ].join("");

  document.getElementById("hero-play").onclick = () => openModal(item);
  document.getElementById("hero-more").onclick = () => openModal(item);

  syncHeroDots(i);

  if (reset) {
    clearInterval(_heroTimer);
    _heroTimer = setInterval(() => goHero((_heroIdx + 1) % _heroItems.length), 7000);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// RAIL SCROLLING
// ══════════════════════════════════════════════════════════════════════════════
function wireRailBtns() {
  document.querySelectorAll(".rail-btn").forEach(btn => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener("click", e => {
      e.stopPropagation();
      const rail = document.getElementById(newBtn.dataset.rail);
      if (!rail) return;
      rail.scrollBy({ left: (newBtn.classList.contains("prev") ? -1 : 1) * rail.clientWidth * 0.78, behavior: "smooth" });
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPAND PANEL (Hover Portal)
// ══════════════════════════════════════════════════════════════════════════════
let _mouseX = 0, _mouseY = 0;
document.addEventListener("mousemove", e => { _mouseX = e.clientX; _mouseY = e.clientY; }, { passive: true });

let _hoverTimer = null;
let _activeCard = null;
let _expandEl   = null;

function getExpandEl() {
  if (_expandEl) return _expandEl;
  _expandEl = document.createElement("div");
  _expandEl.className = "card-expand";
  document.body.appendChild(_expandEl);
  _expandEl.addEventListener("mouseenter", () => clearTimeout(_hoverTimer));
  _expandEl.addEventListener("mouseleave", () => {
    clearTimeout(_hoverTimer);
    _hoverTimer = setTimeout(clearActive, 80);
  });
  return _expandEl;
}

function positionExpand() {
  const panel  = getExpandEl();
  const pw     = panel.offsetWidth  || 260;
  const ph     = panel.offsetHeight || 320;
  const vw     = window.innerWidth;
  const vh     = window.innerHeight;
  const offset = 16;
  const margin = 8;
  let left = _mouseX + offset;
  let top  = _mouseY - ph / 2;
  if (left + pw > vw - margin) left = _mouseX - pw - offset;
  if (top < margin) top = margin;
  if (top + ph > vh - margin) top = vh - ph - margin;
  panel.style.left = left + "px";
  panel.style.top  = top  + "px";
}

function clearActive() {
  clearTimeout(_hoverTimer);
  if (_expandEl) {
    _expandEl.classList.remove("visible");
    const iframe = _expandEl.querySelector("iframe");
    if (iframe) { iframe.src = ""; iframe.remove(); }
  }
  if (_activeCard) {
    _activeCard.classList.remove("is-hovered");
    _activeCard.style.zIndex = "";
    _activeCard = null;
  }
}

function activateCard(card, item, customPlayAction = null) {
  if (_activeCard === card) return;
  if (_activeCard) {
    _activeCard.classList.remove("is-hovered");
    _activeCard.style.zIndex = "";
    _activeCard = null;
  }
  _activeCard = card;
  card.classList.add("is-hovered");
  card.style.zIndex = "50";

  const panel    = getExpandEl();
  const url      = trailerUrl(item.trailer);
  const fallback = item.bannerImage || item.coverImage?.extraLarge || "";
  const mediaHtml = url
    ? `<iframe src="${url}" allow="autoplay; fullscreen"></iframe>`
    : `<img src="${px(fallback)}" alt="" loading="lazy" />`;

  const desc  = synopsis2(item.description, 2);
  const score = sc(item);
  const ep    = epStr(item);

  panel.innerHTML = `
    <div class="expand-media">${mediaHtml}</div>
    <div class="expand-body">
      <div class="expand-actions">
        <button class="expand-play js-play" title="Play">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="expand-add" title="Edit on AniList">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="expand-info js-info" title="More info">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
      <div class="expand-title">${ttl(item)}</div>
      ${desc ? `<p class="expand-desc">${desc}</p>` : ""}
      <div class="expand-chips">
        ${score ? `<span class="x-chip score">★ ${score}</span>` : ""}
        ${ep    ? `<span class="x-chip ep">${ep}</span>`         : ""}
        ${(item.genres || []).slice(0, 2).map(g => `<span class="x-chip">${g}</span>`).join("")}
      </div>
    </div>
  `;

  panel.querySelector(".js-play")?.addEventListener("click", e => {
    e.stopPropagation();
    clearActive();
    if (customPlayAction) customPlayAction(); else openModal(item);
  });

  panel.querySelector(".js-info")?.addEventListener("click", e => {
    e.stopPropagation();
    clearActive();
    openModal(item);
  });

  const expandAddBtn = panel.querySelector(".expand-add");
  const plusIcon   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  const pencilIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

  if (expandAddBtn) {
    expandAddBtn.innerHTML = plusIcon;
    expandAddBtn.title = "Add to AniList";
  }

  expandAddBtn?.addEventListener("click", e => {
    e.stopPropagation();
    clearActive();
    openEditModal(item);
  });

  fetch("/api/me").then(r => r.json()).then(async me => {
    if (!me.success || !me.token || !expandAddBtn) return;
    const r = await fetch("/api/anilist", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${me.token}` },
      body: JSON.stringify({
        query: `query($mediaId:Int,$userId:Int){MediaList(mediaId:$mediaId,userId:$userId){id}}`,
        variables: { mediaId: item.id, userId: parseInt(me.userId) }
      })
    });
    const j = await r.json();
    if (j?.data?.MediaList?.id) {
      expandAddBtn.innerHTML = pencilIcon;
      expandAddBtn.title = "Edit on AniList";
    }
  }).catch(() => {});

  panel.style.visibility = "hidden";
  panel.classList.add("visible");
  requestAnimationFrame(() => { positionExpand(); panel.style.visibility = ""; });
}

function makeCard(item, { numbered = false, wide = false, num = 0 } = {}) {
  const t   = ttl(item);
  const yr  = item.seasonYear || "";
  const fmt = (item.format || "").replace(/_/g, " ");

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    ${numbered ? `<div class="card-num">${num}</div>` : ""}
    <div class="card-thumb">
      <img src="${px(item.coverImage?.extraLarge || item.coverImage?.large)}" alt="${t}" loading="lazy" />
    </div>
    <div class="card-label">
      <div class="card-name">${t}</div>
      <div class="card-sub">${[yr, fmt].filter(Boolean).join(" · ")}</div>
    </div>
  `;

  card.addEventListener("mouseenter", () => {
    clearTimeout(_hoverTimer);
    _hoverTimer = setTimeout(() => activateCard(card, item), 420);
  });
  card.addEventListener("mouseleave", e => {
    if (e.relatedTarget === _expandEl || (_expandEl && _expandEl.contains(e.relatedTarget))) return;
    clearTimeout(_hoverTimer);
    _hoverTimer = setTimeout(clearActive, 100);
  });
  card.addEventListener("click", () => openModal(item));

  return card;
}

function makeCWCard(entry, epData) {
  const media = entry.media;
  const progress = entry.progress || 0;

  const t        = ttl(media);
  const totalEps = media.episodes || 0;
  const nextEp   = progress + 1;
  const pct      = totalEps > 0 ? Math.min((progress / totalEps) * 100, 100) : 0;

  const cover    = media.coverImage?.extraLarge || media.coverImage?.large || "";
  const banner   = media.bannerImage || cover;
  const thumbSrc = epData?.still ? epData.still : banner;
  const epName   = epData?.name || null;

  const isComplete = totalEps > 0 && progress >= totalEps;
  const epBadge    = isComplete ? "Completed" : `Ep ${nextEp}${totalEps ? ` / ${totalEps}` : ""}`;

  const card = document.createElement("div");
  card.className = "card cw";
  card.innerHTML = `
    <div class="card-thumb">
      <img src="${thumbSrc.startsWith("https://image.tmdb") ? `/api/v1/proxy?url=${encodeURIComponent(thumbSrc)}` : px(thumbSrc)}" alt="${t}" loading="lazy" />
      <div class="cw-ep-badge">${epBadge}</div>
      ${pct > 0 ? `
        <div class="cw-progress-bar">
          <div class="cw-progress-fill" style="width:${pct}%"></div>
        </div>` : ""}
    </div>
    <div class="card-label">
      <div class="card-name">${t}</div>
      <div class="card-sub">${epName ? epName : [media.seasonYear, (media.format || "").replace(/_/g, " ")].filter(Boolean).join(" · ")}</div>
    </div>
  `;

  const playAction = () => playFromModal(media, nextEp);

  card.addEventListener("mouseenter", () => {
    clearTimeout(_hoverTimer);
    _hoverTimer = setTimeout(() => activateCard(card, media, playAction), 420);
  });
  card.addEventListener("mouseleave", e => {
    if (e.relatedTarget === _expandEl || (_expandEl && _expandEl.contains(e.relatedTarget))) return;
    clearTimeout(_hoverTimer);
    _hoverTimer = setTimeout(clearActive, 100);
  });
  card.addEventListener("click", playAction);

  return card;
}

// ══════════════════════════════════════════════════════════════════════════════
// DATA FETCHING AND RENDERING
// ══════════════════════════════════════════════════════════════════════════════

async function loadMyList() {
  try {
    const meRes = await fetch("/api/me");
    if (!meRes.ok) throw new Error("Backend offline");
    const me = await meRes.json();

    if (!me.success || !me.token) {
      document.getElementById("not-logged-in").style.display = "block";
      return;
    }

    _currentUserId = me.userId;
    const cacheKey = `mylist_${me.userId}`;

    // Try hitting cache first (15 mins)
    let lists = cGet(cacheKey);

    // Cache Miss: Fetch from AniList
    if (!lists) {
      const gqlRes = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${me.token}`,
        },
        body: JSON.stringify({
          query: `
            query($userId: Int) {
              MediaListCollection(userId: $userId, type: ANIME, sort: UPDATED_TIME_DESC) {
                lists {
                  status
                  entries {
                    progress
                    score(format: POINT_10_DECIMAL)
                    media {
                      id
                      idMal
                      title { english romaji }
                      coverImage { extraLarge large color }
                      bannerImage
                      episodes
                      averageScore
                      format
                      status
                      season
                      seasonYear
                      genres
                      description(asHtml: false)
                      trailer { id site }
                      nextAiringEpisode { episode }
                    }
                  }
                }
              }
            }
          `,
          variables: { userId: parseInt(me.userId) },
        }),
      });

      const gqlData = await gqlRes.json();
      lists = gqlData?.data?.MediaListCollection?.lists || [];

      // Save lists to session storage for 15 mins (900000 ms)
      cSet(cacheKey, lists, 900000);
    }

    // Process lists into state
    lists.forEach(list => {
      if (list.status === "DROPPED") return;
      if (_listData[list.status]) {
        _listData[list.status] = list.entries || [];
      }
    });

    // Populate Hero using PLANNING list
    if (_listData.PLANNING && _listData.PLANNING.length > 0) {
      _heroItems = _listData.PLANNING.map(e => e.media).slice(0, 6);
      document.getElementById("hero").style.display = "block";
      document.getElementById("page-header").style.display = "none";
      buildHeroDots();
      goHero(0, true);
    } else {
      document.getElementById("hero").style.display = "none";
      document.getElementById("page-header").style.display = "block";
    }

    await renderCurrentRow(_listData.CURRENT);
    renderStandardRow("PLANNING", _listData.PLANNING);
    renderStandardRow("COMPLETED", _listData.COMPLETED);
    renderStandardRow("PAUSED", _listData.PAUSED);

    setupFilters();

  } catch (err) {
    console.error("Failed to load list:", err);
  }
}

async function renderCurrentRow(entries) {
  const row = document.getElementById("row-CURRENT");
  const rail = document.getElementById("r-CURRENT");
  rail.innerHTML = "";

  if (!entries.length) {
    row.style.display = "none";
    return;
  }

  row.style.display = "block";

  const epFetches = entries.map(({ media, progress }) =>
    fetch(`/api/episodes/${media.id}?t=${Date.now()}`)
      .then(r => r.json())
      .then(j => {
        const eps    = j.episodes || [];
        const nextEp = progress + 1;
        return eps.find(e => e.number === nextEp) || eps[nextEp - 1] || null;
      })
      .catch(() => null)
  );

  const epResults = await Promise.all(epFetches);

  entries.forEach((entry, idx) => {
    const totalEps = entry.media.episodes || 0;
    const progress = entry.progress || 0;
    const nextAiring = entry.media.nextAiringEpisode?.episode ?? null;
    const latestReleased = nextAiring != null ? nextAiring - 1 : totalEps > 0 ? totalEps : null;

    if (latestReleased != null && progress >= latestReleased) return;

    rail.appendChild(makeCWCard(entry, epResults[idx]));
  });

  if (rail.children.length === 0) row.style.display = "none";
  wireRailBtns();
}

function renderStandardRow(status, entries) {
  const row = document.getElementById(`row-${status}`);
  const rail = document.getElementById(`r-${status}`);
  rail.innerHTML = "";

  if (!entries.length) {
    row.style.display = "none";
    return;
  }

  row.style.display = "block";
  entries.forEach(entry => {
    rail.appendChild(makeCard(entry.media));
  });

  wireRailBtns();
}

// ══════════════════════════════════════════════════════════════════════════════
// LOCAL SEARCH FILTERING
// ══════════════════════════════════════════════════════════════════════════════
function setupFilters() {
  document.querySelectorAll(".list-filter-input").forEach(input => {
    input.addEventListener("input", async (e) => {
      const status = e.target.dataset.status;
      const query = e.target.value.trim().toLowerCase();

      const filtered = _listData[status].filter(entry => {
        if (!query) return true;
        const titleEn = (entry.media.title.english || "").toLowerCase();
        const titleRo = (entry.media.title.romaji || "").toLowerCase();
        return titleEn.includes(query) || titleRo.includes(query);
      });

      if (status === "CURRENT") {
        await renderCurrentRow(filtered);
      } else {
        renderStandardRow(status, filtered);
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL LOGIC
// ══════════════════════════════════════════════════════════════════════════════

async function loadEpisodes(anilistId) {
  try {
    const res  = await fetch(`/api/episodes/${anilistId}?t=${Date.now()}`);
    const json = await res.json();
    return json.episodes || [];
  } catch (_) { return []; }
}

function renderEpisodes(episodes) {
  const list    = document.getElementById("modal-eps-list");
  const countEl = document.getElementById("modal-eps-count");
  const section = document.getElementById("modal-eps-section");

  if (!episodes.length) {
    section.style.display = "block";
    list.innerHTML = `<p class="eps-empty">No episode data found for this title.</p>`;
    countEl.textContent = "";
    return;
  }

  section.style.display = "block";
  countEl.textContent = `${episodes.length} Episode${episodes.length !== 1 ? "s" : ""}`;

  list.addEventListener("click", e => {
    const row = e.target.closest(".ep-row[data-epnum]");
    if (!row || !_modalCurrentItem) return;
    playFromModal(_modalCurrentItem, parseInt(row.dataset.epnum));
  }, { once: false });

  list.innerHTML = episodes.map(ep => {
    const epTitle = ep.name || `Episode ${ep.number}`;
    const thumbHtml = ep.still
      ? `<img src="/api/v1/proxy?url=${encodeURIComponent(ep.still)}" alt="${epTitle}" loading="lazy" />`
      : `<div class="ep-thumb-placeholder">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
             <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
           </svg>
         </div>`;
    const duration = ep.runtime ? `${ep.runtime}m` : "";

    return `
      <div class="ep-row" data-epnum="${ep.number}" style="cursor:pointer;">
        <div class="ep-num">${ep.number}</div>
        <div class="ep-thumb">
          ${thumbHtml}
          <div class="ep-play-overlay">
            <div class="ep-play-circle">
              <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>
        </div>
        <div class="ep-title-row">
          <span class="ep-title">${epTitle}</span>
          ${duration ? `<span class="ep-duration">${duration}</span>` : ""}
        </div>
        ${ep.overview ? `<p class="ep-desc">${ep.overview}</p>` : "<p class='ep-desc'></p>"}
      </div>`;
  }).join("");
}

let _modalItemId = null;
let _modalCurrentItem = null;

function openModal(item) {
  clearActive();
  _modalItemId     = item.id;
  _modalCurrentItem = item;

  const t      = ttl(item);
  const score  = sc(item);
  const banner = item.bannerImage || item.coverImage?.extraLarge || "";

  const modalTop  = document.querySelector(".modal-top");
  const oldIframe = modalTop ? modalTop.querySelector(".modal-trailer") : null;
  if (oldIframe) { oldIframe.src = ""; oldIframe.remove(); }

  const trailerSrc = trailerUrl(item.trailer);
  const bannerEl   = document.getElementById("modal-banner");

  if (trailerSrc && modalTop) {
    if (bannerEl) bannerEl.style.display = "none";
    const iframe = document.createElement("iframe");
    iframe.className = "modal-trailer";
    iframe.src = trailerSrc;
    iframe.allow = "autoplay; fullscreen";
    iframe.setAttribute("allowfullscreen", "");
    const scrim = modalTop.querySelector(".modal-top-scrim");
    if (scrim) {
      modalTop.insertBefore(iframe, scrim);
    } else {
      modalTop.appendChild(iframe);
    }
  } else {
    if (bannerEl) {
      bannerEl.style.display = "block";
      bannerEl.src = px(banner);
    }
  }

  document.getElementById("modal-title").textContent    = t;
  document.getElementById("modal-synopsis").textContent = synopsis2(item.description, 6) || "No description available.";
  document.getElementById("m-genres").textContent  = (item.genres || []).join(", ") || "—";
  document.getElementById("m-format").textContent  = (item.format || "—").replace(/_/g, " ");
  document.getElementById("m-eps").textContent     = item.episodes ? String(item.episodes) : (item.status === "RELEASING" ? "Ongoing" : "—");
  document.getElementById("m-status").textContent  = (item.status || "—").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  document.getElementById("m-score").textContent   = score ? `★ ${score} / 10` : "—";
  document.getElementById("modal-chips").innerHTML = [
    item.seasonYear ? `<span class="m-chip">${item.seasonYear}</span>` : "",
    item.season     ? `<span class="m-chip">${item.season}</span>` : "",
    score           ? `<span class="m-chip score">★ ${score}</span>` : "",
    item.format     ? `<span class="m-chip">${item.format.replace(/_/g, " ")}</span>` : "",
  ].join("");
  document.getElementById("modal-play").onclick = () => playFromModal(item);

  const editBtn = document.getElementById("modal-edit-btn");
  const addBtn  = document.getElementById("modal-add-btn");

  editBtn.style.display = "";
  addBtn.style.display  = "none";
  editBtn.onclick = () => openEditModal(item);

  const section = document.getElementById("modal-eps-section");
  const list    = document.getElementById("modal-eps-list");
  const countEl = document.getElementById("modal-eps-count");
  section.style.display = "block";
  countEl.textContent   = "";
  list.innerHTML = `
    <div class="eps-loading">
      <div class="eps-spinner"></div>
      <span>Loading episodes…</span>
    </div>`;

  document.getElementById("modal-backdrop").classList.add("open");
  document.body.style.overflow = "hidden";

  const isMovie = (item.format || "").includes("MOVIE");

  if (item.id && !isMovie) {
    const thisId = item.id;
    loadEpisodes(thisId).then(eps => {
      if (_modalItemId === thisId && document.getElementById("modal-backdrop").classList.contains("open")) {
        renderEpisodes(eps);
      }
    });
  } else {
    section.style.display = "none";
  }
}

function closeModal() {
  _modalItemId = null;
  const iframe = document.querySelector(".modal-trailer");
  if (iframe) { iframe.src = ""; iframe.remove(); }
  const bannerEl = document.getElementById("modal-banner");
  if (bannerEl) bannerEl.style.display = "block";
  document.getElementById("modal-backdrop").classList.remove("open");
  document.body.style.overflow = "";
}

document.getElementById("modal-close").onclick = closeModal;
document.getElementById("modal-backdrop").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-backdrop")) closeModal();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });


// ══════════════════════════════════════════════════════════════════════════════
// PLAYER INTEGRATION
// ══════════════════════════════════════════════════════════════════════════════
const _extCache = {};

async function findExtensionMatch(item) {
  if (_extCache[item.id]) return _extCache[item.id];
  const title = ttl(item);

  const exts = await fetch("/api/extensions").then(r => r.json()).catch(() => []);
  if (!exts.length) return null;

  for (const ext of exts) {
    try {
      const results = await fetch(
        `/api/ext/${ext.id}/search?q=${encodeURIComponent(title)}&dub=false`
      ).then(r => r.json());

      if (!results.length) continue;

      const best = results[0];
      _extCache[item.id] = { extId: ext.id, showId: best.id, showTitle: title };
      return _extCache[item.id];
    } catch (_) { continue; }
  }
  return null;
}

async function playFromModal(item, episodeNumber = null) {
  closeModal();

  if (!window.AtlasPlayer) {
    console.error("[player] AtlasPlayer not available");
    return;
  }

  const showTitleText = ttl(item);
  const targetNum     = episodeNumber || 1;

  let malId = item.idMal || null;
  if (!malId && item.id) {
    try {
      const r = await fetch("/api/anilist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query($id:Int){Media(id:$id,type:ANIME){idMal}}`,
          variables: { id: item.id }
        })
      });
      const j = await r.json();
      malId = j?.data?.Media?.idMal || null;
    } catch (_) {}
  }

  window.AtlasPlayer.openLoading(showTitleText, `Episode ${targetNum}`);

  try {
    const match = await findExtensionMatch(item);
    if (!match) throw new Error("No streaming source found for this title.");

    const [extRaw, tmdbEps] = await Promise.all([
      fetch(`/api/ext/${match.extId}/episodes?showId=${encodeURIComponent(match.showId)}`).then(r => r.json()).catch(() => []),
      loadEpisodes(item.id),
    ]);

    const extRes = Array.isArray(extRaw) ? extRaw : (extRaw?.episodes || []);
    if (!extRes.length) throw new Error("No episodes found from extension.");

    window.AtlasPlayer.playEpisode(
      match.extId,
      showTitleText,
      extRes,
      targetNum,
      tmdbEps,
      false,
      malId,
      item.id
    );

  } catch (e) {
    if (window.AtlasPlayer) window.AtlasPlayer.showError(e.message || "Failed to load stream.");
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ANILIST EDIT LOGIC
// ══════════════════════════════════════════════════════════════════════════════
let _editItem    = null;
let _editEntryId = null;
let _editToken   = null;

async function getToken() {
  if (_editToken) return _editToken;
  try {
    const r = await fetch("/api/me");
    const d = await r.json();
    if (d.success && d.token) { _editToken = d.token; return _editToken; }
  } catch (_) {}
  return null;
}

async function fetchListEntry(mediaId, token, userId) {
  const r = await fetch("/api/anilist", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: `query($mediaId:Int,$userId:Int){
        MediaList(mediaId:$mediaId,userId:$userId){
          id status progress score(format:POINT_10_DECIMAL)
        }
      }`,
      variables: { mediaId, userId }
    })
  });
  const j = await r.json();
  return j?.data?.MediaList || null;
}

async function saveListEntry(mediaId, status, progress, score, token) {
  const r = await fetch("/api/anilist", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: `mutation($mediaId:Int,$status:MediaListStatus,$progress:Int,$score:Float){
        SaveMediaListEntry(mediaId:$mediaId,status:$status,progress:$progress,score:$score){
          id status progress score(format:POINT_10_DECIMAL)
        }
      }`,
      variables: { mediaId, status, progress: parseInt(progress) || 0, score: parseFloat(score) || 0 }
    })
  });
  const j = await r.json();
  return j?.data?.SaveMediaListEntry || null;
}

async function removeListEntry(entryId, token) {
  const r = await fetch("/api/anilist", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: `mutation($id:Int){ DeleteMediaListEntry(id:$id){ deleted } }`,
      variables: { id: entryId }
    })
  });
  const j = await r.json();
  return j?.data?.DeleteMediaListEntry?.deleted || false;
}

function setEditFeedback(msg, isErr = false) {
  const el = document.getElementById("edit-feedback");
  el.textContent = msg;
  el.className   = "edit-feedback" + (isErr ? " err" : "");
}

async function openEditModal(item) {
  _editItem = item;
  _editEntryId = null;

  document.getElementById("edit-modal-title").textContent = ttl(item);
  document.getElementById("edit-progress-max").textContent =
    item.episodes ? `/ ${item.episodes}` : "";
  setEditFeedback("");

  document.getElementById("edit-status").value    = "CURRENT";
  document.getElementById("edit-progress").value  = "0";
  document.getElementById("edit-score").value     = "0";
  document.getElementById("edit-save").disabled   = true;
  document.getElementById("edit-save").textContent = "Loading…";
  document.getElementById("edit-remove").style.display = "none";

  document.getElementById("edit-backdrop").classList.add("open");

  const token = await getToken();
  if (!token) {
    setEditFeedback("Not logged in to AniList", true);
    document.getElementById("edit-save").disabled = false;
    return;
  }

  try {
    const meRes = await fetch("/api/me");
    const me    = await meRes.json();
    if (me.success && me.userId) {
      const entry = await fetchListEntry(item.id, token, parseInt(me.userId));
      if (entry) {
        _editEntryId = entry.id;
        document.getElementById("edit-status").value   = entry.status || "CURRENT";
        document.getElementById("edit-progress").value = entry.progress || 0;
        document.getElementById("edit-score").value    = entry.score || 0;
        document.getElementById("edit-remove").style.display = "block";
        document.getElementById("edit-save").textContent = "Save Changes";
      }
    }
  } catch (_) {}

  document.getElementById("edit-save").disabled = false;
}

function closeEditModal() {
  document.getElementById("edit-backdrop").classList.remove("open");
  _editItem = null; _editEntryId = null;
}

document.getElementById("edit-step-down").onclick  = () => {
  const el = document.getElementById("edit-progress");
  el.value = Math.max(0, parseInt(el.value || 0) - 1);
};
document.getElementById("edit-step-up").onclick = () => {
  const el  = document.getElementById("edit-progress");
  const max = _editItem?.episodes || Infinity;
  el.value  = Math.min(max, parseInt(el.value || 0) + 1);
};
document.getElementById("edit-score-down").onclick = () => {
  const el = document.getElementById("edit-score");
  el.value = Math.max(0, parseFloat(el.value || 0) - 0.5).toFixed(1);
};
document.getElementById("edit-score-up").onclick = () => {
  const el = document.getElementById("edit-score");
  el.value = Math.min(10, parseFloat(el.value || 0) + 0.5).toFixed(1);
};

document.getElementById("edit-save").onclick = async () => {
  if (!_editItem) return;
  const btn  = document.getElementById("edit-save");
  btn.disabled = true; btn.textContent = "Saving…";
  setEditFeedback("");

  const token    = await getToken();
  const status   = document.getElementById("edit-status").value;
  const progress = document.getElementById("edit-progress").value;
  const score    = document.getElementById("edit-score").value;

  try {
    const saved = await saveListEntry(_editItem.id, status, progress, score, token);
    if (saved) {
      _editEntryId = saved.id;
      setEditFeedback("✓ Saved successfully");
      document.getElementById("edit-remove").style.display = "block";

      // Invalidate Cache explicitly for the user before reloading!
      if (_currentUserId) cRemove(`mylist_${_currentUserId}`);
      setTimeout(loadMyList, 800);
    } else {
      setEditFeedback("Save failed — try again", true);
    }
  } catch (_) { setEditFeedback("Error saving", true); }

  btn.disabled = false; btn.textContent = "Save";
};

document.getElementById("edit-remove").onclick = async () => {
  if (!_editEntryId) return;
  if (!confirm("Remove from your AniList?")) return;
  const btn = document.getElementById("edit-remove");
  btn.textContent = "Removing…";
  const token = await getToken();
  try {
    const ok = await removeListEntry(_editEntryId, token);
    if (ok) {
      setEditFeedback("✓ Removed from list");
      btn.style.display = "none";

      // Invalidate Cache explicitly for the user before reloading!
      if (_currentUserId) cRemove(`mylist_${_currentUserId}`);
      setTimeout(() => { closeEditModal(); loadMyList(); }, 900);
    } else { setEditFeedback("Remove failed", true); btn.textContent = "Remove from List"; }
  } catch (_) { setEditFeedback("Error removing", true); btn.textContent = "Remove from List"; }
};

document.getElementById("edit-close").onclick = closeEditModal;
document.getElementById("edit-backdrop").addEventListener("click", e => {
  if (e.target === document.getElementById("edit-backdrop")) closeEditModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.getElementById("edit-backdrop").classList.contains("open")) {
    closeEditModal();
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// BOOTSTRAP
// ══════════════════════════════════════════════════════════════════════════════
loadMyList();
