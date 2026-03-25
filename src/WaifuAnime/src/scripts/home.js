// ══════════════════════════════════════════════════════════════════════════════
// CACHE — clear all stale sessionStorage on every page load
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

let _currentUserId = null; // Tracked to invalidate cache on edits

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
// ANILIST
// ══════════════════════════════════════════════════════════════════════════════
const F = `id idMal title{english romaji} coverImage{extraLarge large color}
  bannerImage averageScore episodes format status season seasonYear
  genres description(asHtml:false) trailer{id site}`;

async function gql(key, ttl, q, vars = {}) {
  const hit = cGet(key);
  if (hit) return hit;
  try {
    const r = await fetch("/api/anilist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, variables: vars }),
    });
    const j = await r.json();
    if (j?.data) { cSet(key, j.data, ttl); return j.data; }
  } catch (_) {}
  return null;
}

function getSeason(m) { return m < 3 ? "WINTER" : m < 6 ? "SPRING" : m < 9 ? "SUMMER" : "FALL"; }

async function loadAll() {
  const now = new Date(), s = getSeason(now.getMonth()), y = now.getFullYear();
  return Promise.all([
    gql("trending",      TTL.trending, `query{Page(perPage:20){media(sort:TRENDING_DESC,type:ANIME,isAdult:false){${F}}}}`),
    gql(`pop_${s}_${y}`, TTL.popular,  `query($s:MediaSeason,$y:Int){Page(perPage:20){media(sort:POPULARITY_DESC,type:ANIME,season:$s,seasonYear:$y,isAdult:false){${F}}}}`, { s, y }),
    gql("top",           TTL.top,      `query{Page(perPage:20){media(sort:SCORE_DESC,type:ANIME,isAdult:false){${F}}}}`),
    gql("airing",        TTL.airing,   `query{Page(perPage:20){media(sort:TRENDING_DESC,type:ANIME,status:RELEASING,isAdult:false){${F}}}}`),
    gql("movies",        TTL.movies,   `query{Page(perPage:20){media(sort:POPULARITY_DESC,type:ANIME,format:MOVIE,isAdult:false){${F}}}}`),
  ]);
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════
const px    = url => url ? `/api/proxy?url=${encodeURIComponent(url)}` : "";
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
// HERO
// ══════════════════════════════════════════════════════════════════════════════
let _items = [], _idx = 0, _timer = null;

function buildDots() {
  const c = document.getElementById("hero-progress");
  c.innerHTML = "";
  _items.forEach((_, i) => {
    const b = document.createElement("button");
    b.className = "h-dot" + (i === 0 ? " on" : "");
    b.onclick = () => goHero(i, true);
    c.appendChild(b);
  });
}
function syncDots(i) {
  document.querySelectorAll(".h-dot").forEach((d, n) => d.classList.toggle("on", n === i));
}
function goHero(i, reset = false) {
  const item = _items[i]; if (!item) return;
  _idx = i;
  const img = document.getElementById("hero-img");
  img.style.opacity = "0";
  setTimeout(() => { img.src = px(item.bannerImage || item.coverImage?.extraLarge); img.style.opacity = "1"; }, 280);
  document.getElementById("hero-rank").textContent     = i + 1;
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
  syncDots(i);
  if (reset) { clearInterval(_timer); _timer = setInterval(() => goHero((_idx + 1) % _items.length), 7000); }
}

// ══════════════════════════════════════════════════════════════════════════════
// RAIL SCROLL
// ══════════════════════════════════════════════════════════════════════════════
function wireRailBtns() {
  document.querySelectorAll(".rail-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const rail = document.getElementById(btn.dataset.rail);
      if (!rail) return;
      rail.scrollBy({ left: (btn.classList.contains("prev") ? -1 : 1) * rail.clientWidth * 0.78, behavior: "smooth" });
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPAND PANEL — portaled to body, positioned at mouse cursor
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

function activateCard(card, item) {
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
        <button class="expand-add" title="Add / Edit on AniList">
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

  panel.querySelector(".js-play")?.addEventListener("click",  e => { e.stopPropagation(); clearActive(); openModal(item); });
  panel.querySelector(".js-info")?.addEventListener("click",  e => { e.stopPropagation(); clearActive(); openModal(item); });
  const expandAddBtn = panel.querySelector(".expand-add");

  // Set initial icon to +
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

  // Check list membership — swap to pencil if already in list
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

function fillRail(id, items, opts = {}) {
  const rail = document.getElementById(id);
  rail.innerHTML = "";
  items.forEach((item, i) => rail.appendChild(makeCard(item, { ...opts, num: i + 1 })));
}

// ══════════════════════════════════════════════════════════════════════════════
// SKELETONS
// ══════════════════════════════════════════════════════════════════════════════
function skels(id, n = 8, cls = "") {
  const rail = document.getElementById(id);
  rail.innerHTML = Array.from({ length: n }, () => `
    <div class="skel${cls ? " " + cls : ""}">
      <div class="skel-img"></div>
      <div class="skel-line"></div>
      <div class="skel-line s"></div>
    </div>`).join("");
}

// ══════════════════════════════════════════════════════════════════════════════
// EPISODES — no client-side cache so every modal open hits the server fresh
// The server has its own 6-hour cache so it's still fast, but stale JS results
// can never cause mismatches.
// ══════════════════════════════════════════════════════════════════════════════
async function loadEpisodes(anilistId) {
  try {
    // Always fetch fresh from server — server handles caching
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

  // Wire ep-row clicks via delegation after render (data-epnum approach avoids inline onclick scope issues)
  list.addEventListener("click", e => {
    const row = e.target.closest(".ep-row[data-epnum]");
    if (!row || !_modalCurrentItem) return;
    playFromModal(_modalCurrentItem, parseInt(row.dataset.epnum));
  }, { once: false });

  list.innerHTML = episodes.map(ep => {
    const epTitle = ep.name || `Episode ${ep.number}`;
    const thumbHtml = ep.still
      ? `<img src="/api/proxy?url=${encodeURIComponent(ep.still)}" alt="${epTitle}" loading="lazy" />`
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

// ══════════════════════════════════════════════════════════════════════════════
// MODAL
// ══════════════════════════════════════════════════════════════════════════════
// Track which item the modal is currently showing so async episode loads
// don't render into a modal that has already moved on to a different show
let _modalItemId = null;
let _modalCurrentItem = null; // the full item for episode row clicks

function openModal(item) {
  clearActive();
  _modalItemId     = item.id;
  _modalCurrentItem = item;

  const t      = ttl(item);
  const score  = sc(item);
  const banner = item.bannerImage || item.coverImage?.extraLarge || "";

  // Trailer or banner in modal top
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

  // Wire pencil/add buttons:
  // - pencil only if show is in user's list
  // - + if not in list or not logged in
  const editBtn = document.getElementById("modal-edit-btn");
  const addBtn  = document.getElementById("modal-add-btn");

  // Reset to + while we check
  editBtn.style.display = "none";
  addBtn.style.display  = "";
  editBtn.onclick = () => openEditModal(item);
  addBtn.onclick  = () => openEditModal(item);  // add modal handles both add and edit

  fetch("/api/me").then(r => r.json()).then(async me => {
    if (!me.success || !me.token) return; // not logged in — keep + visible
    // Check if this item is in the user's list
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
      // In list — show pencil
      editBtn.style.display = "";
      addBtn.style.display  = "none";
    }
    // else not in list — keep + visible
  }).catch(() => {});


  // Reset episodes to loading state
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

  // Skip episodes for movies — only TV shows have episode data
  const isMovie = (item.format || "").includes("MOVIE");

  // Load episodes — guarded by item ID so switching modals quickly doesn't bleed
  if (item.id && !isMovie) {
    const thisId = item.id;
    loadEpisodes(thisId).then(eps => {
      if (_modalItemId === thisId && document.getElementById("modal-backdrop").classList.contains("open")) {
        renderEpisodes(eps);
      }
    });
  } else {
    // Movie or no ID — hide the episodes section entirely
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
// ANILIST EDIT — fetch list entry, open mini-modal, save/remove
// ══════════════════════════════════════════════════════════════════════════════
let _editItem    = null; // the media item currently in the edit modal
let _editEntryId = null; // AniList MediaList entry id (needed for delete)
let _editToken   = null; // cached bearer token

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

  // Reset fields to defaults while we fetch
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

  // Fetch existing entry if any
  try {
    const meRes = await fetch("/api/me");
    const me    = await meRes.json();
    if (me.success && me.userId) {
      const entry = await fetchListEntry(item.id, token, parseInt(me.userId));
      if (entry) {
        // Already in list — populate existing values
        _editEntryId = entry.id;
        document.getElementById("edit-status").value   = entry.status || "CURRENT";
        document.getElementById("edit-progress").value = entry.progress || 0;
        document.getElementById("edit-score").value    = entry.score || 0;
        document.getElementById("edit-remove").style.display = "block";
        document.getElementById("edit-save").textContent = "Save Changes";
      } else {
        // Not in list yet — adding fresh
        document.getElementById("edit-status").value   = "PLANNING";
        document.getElementById("edit-save").textContent = "Add to List";
      }
    }
  } catch (_) {}

  document.getElementById("edit-save").disabled = false;
}

function closeEditModal() {
  document.getElementById("edit-backdrop").classList.remove("open");
  _editItem = null; _editEntryId = null;
}

// Stepper buttons
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

      // Clear personal cache and refresh the row
      if (_currentUserId) cRemove(`cw_${_currentUserId}`);
      setTimeout(loadContinueWatching, 800);
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

      // Clear personal cache and refresh the row
      if (_currentUserId) cRemove(`cw_${_currentUserId}`);
      setTimeout(() => { closeEditModal(); loadContinueWatching(); }, 900);
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
// SEARCH — Netflix-style: inline expanding nav bar, results replace home page
// ══════════════════════════════════════════════════════════════════════════════
const _searchBox  = document.getElementById("nav-search-box");
const _searchInp  = document.getElementById("search-input");
const _searchPage = document.getElementById("search-page");
const _mainEl     = document.getElementById("main");
const _heroEl     = document.getElementById("hero");

let _searchOpen  = false;
let _searchTimer = null;

function openSearch() {
  _searchOpen = true;
  _searchBox.classList.add("open");
  setTimeout(() => _searchInp.focus(), 50);
}

function closeSearch() {
  _searchOpen = false;
  _searchBox.classList.remove("open");
  _searchInp.value = "";
  _searchPage.classList.remove("open");
  _searchPage.innerHTML = "";
  // Restore home content
  _mainEl.style.display = "";
  _heroEl.style.display = "";
}

document.getElementById("search-toggle").addEventListener("click", () => {
  if (_searchOpen) {
    closeSearch();
  } else {
    openSearch();
  }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && _searchOpen) closeSearch();
});

_searchInp.addEventListener("input", () => {
  clearTimeout(_searchTimer);
  const q = _searchInp.value.trim();
  if (!q) {
    // Empty — show home again
    _searchPage.classList.remove("open");
    _searchPage.innerHTML = "";
    _mainEl.style.display = "";
    _heroEl.style.display = "";
    return;
  }
  // Hide home content, show search page immediately
  _mainEl.style.display = "none";
  _heroEl.style.display = "none";
  _searchPage.classList.add("open");
  // Show spinner while debouncing
  _searchPage.innerHTML = `
    <div class="search-loading">
      <div class="eps-spinner"></div>
      <span>Searching…</span>
    </div>`;
  _searchTimer = setTimeout(() => doSearch(q), 350);
});

async function doSearch(query) {
  try {
    const r = await fetch("/api/anilist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($q:String){Page(perPage:40){media(search:$q,type:ANIME,isAdult:false,sort:SEARCH_MATCH){
          id title{english romaji} coverImage{extraLarge large color}
          bannerImage averageScore episodes format status season seasonYear
          genres description(asHtml:false) trailer{id site}
        }}}`,
        variables: { q: query }
      })
    });
    const j    = await r.json();
    const list = j?.data?.Page?.media || [];

    if (!list.length) {
      _searchPage.innerHTML = `
        <div class="search-empty">
          <h3>Your search for <em>"${query}"</em> did not have any matches.</h3>
          <p>Suggestions:</p>
          <p>· Try different keywords<br>· Try searching for a genre, like "action" or "romance"<br>· Check your spelling</p>
        </div>`;
      return;
    }

    // Render label + grid of real browse cards (identical to row cards + same hover expand)
    _searchPage.innerHTML = `
      <div class="search-row-label">
        Results for <em>"${query}"</em><span>${list.length} titles</span>
      </div>
      <div class="search-grid" id="search-grid"></div>`;

    const grid = document.getElementById("search-grid");
    list.forEach(item => {
      // Use the exact same makeCard function — identical appearance + hover expand
      const card = makeCard(item);
      grid.appendChild(card);
    });

  } catch (_) {
    _searchPage.innerHTML = `
      <div class="search-empty">
        <h3>Something went wrong</h3>
        <p>Couldn't connect to AniList. Try again in a moment.</p>
      </div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PLAYER INTEGRATION
// Searches the best matching extension for a show + launches the player
// ══════════════════════════════════════════════════════════════════════════════

// Cache extension search results to avoid repeat lookups: mediaId → { extId, showId, episodes }
const _extCache = {};

async function findExtensionMatch(item) {
  if (_extCache[item.id]) return _extCache[item.id];

  const title = ttl(item);

  // Get list of loaded extensions from server
  const exts = await fetch("/api/extensions").then(r => r.json()).catch(() => []);
  if (!exts.length) return null;

  // Try first extension (AnimeKai) — search for the show
  for (const ext of exts) {
    try {
      const results = await fetch(
        `/api/ext/${ext.id}/search?q=${encodeURIComponent(title)}&dub=false`
      ).then(r => r.json());

      if (!results.length) continue;

      // Pick best match by title similarity
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

  // Resolve MAL ID — may be missing if item came from a query that didn't include idMal
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
  console.log("[playFromModal] anilist id=", item.id, "malId=", malId);

  window.AtlasPlayer.openLoading(showTitleText, `Episode ${targetNum}`);

  try {
    // 1. Find the extension match for this show
    const match = await findExtensionMatch(item);
    if (!match) throw new Error("No streaming source found for this title.");

    // 2. Get extension episode list + TMDB episode list (for panel thumbnails) in parallel
    const [extRaw, tmdbEps] = await Promise.all([
      fetch(`/api/ext/${match.extId}/episodes?showId=${encodeURIComponent(match.showId)}`).then(r => r.json()).catch(() => []),
      loadEpisodes(item.id),
    ]);

    // Server may return array directly or { error } — normalise
    const extRes = Array.isArray(extRaw) ? extRaw : (extRaw?.episodes || []);
    if (!extRes.length) throw new Error("No episodes found from extension.");

    // 3. Hand everything to the player
    window.AtlasPlayer.playEpisode(
      match.extId,
      showTitleText,
      extRes,
      targetNum,
      tmdbEps,
      false,
      malId,         // MAL ID for AniSkip — guaranteed resolved
      item.id
    );

  } catch (e) {
    console.error("[player] playFromModal error:", e.message);
    if (window.AtlasPlayer) window.AtlasPlayer.showError(e.message || "Failed to load stream.");
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// NAV SCROLL
// ══════════════════════════════════════════════════════════════════════════════
window.addEventListener("scroll", () => {
  document.getElementById("nav").classList.toggle("scrolled", window.scrollY > 50);
}, { passive: true });

// ══════════════════════════════════════════════════════════════════════════════
// CONTINUE WATCHING (WITH 12 MIN CACHE)
// ══════════════════════════════════════════════════════════════════════════════
async function loadContinueWatching() {
  try {
    // Hit the launcher's AniList proxy — port 3000, same as WaifuManga uses
    const meRes = await fetch("/api/me");
    if (!meRes.ok) return;
    const me = await meRes.json();
    if (!me.success || !me.token) return;

    _currentUserId = me.userId;
    const cacheKey = `cw_${me.userId}`;

    // Check 12 minute cache
    let gqlData = cGet(cacheKey);

    if (!gqlData) {
      // Query AniList for the user's currently watching list, sorted by last updated
      const gqlRes = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${me.token}`,
        },
        body: JSON.stringify({
          query: `
            query($userId: Int) {
              MediaListCollection(userId: $userId, type: ANIME, status: CURRENT, sort: UPDATED_TIME_DESC) {
                lists {
                  entries {
                    progress
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

      gqlData = await gqlRes.json();

      // Cache data if valid
      if (gqlData?.data) {
        cSet(cacheKey, gqlData, TTL_12M);
      }
    }

    const lists   = gqlData?.data?.MediaListCollection?.lists || [];
    const entries = lists.flatMap(l => l.entries);
    if (!entries.length) return;

    // Show the row — no avatar or user ID shown, just the section title
    const row = document.getElementById("row-continue");
    row.style.display = "block";

    // Hide the cw-user element entirely
    document.getElementById("cw-user").style.display = "none";

    const rail = document.getElementById("r-continue");
    rail.innerHTML = "";

    // Fetch episode names for each entry in parallel so we can show
    // the exact episode name the user is on
    const epFetches = entries.map(({ media, progress }) =>
      fetch(`/api/episodes/${media.id}?t=${Date.now()}`)
        .then(r => r.json())
        .then(j => {
          const eps    = j.episodes || [];
          const nextEp = progress + 1;
          // Episode list is 1-indexed (number: 1, 2, 3...)
          const epData = eps.find(e => e.number === nextEp) || eps[nextEp - 1] || null;
          return epData;
        })
        .catch(() => null)
    );

    const epResults = await Promise.all(epFetches);

    entries.forEach(({ media, progress }, idx) => {
      const t        = media.title.english || media.title.romaji || "Unknown";
      const totalEps = media.episodes || 0;
      const nextEp   = progress + 1;

      // Latest released episode:
      // - Airing: nextAiringEpisode.episode - 1  (e.g. next is ep 9 → latest released is 8)
      // - Finished: totalEps (all episodes are out)
      // - Unknown total, not airing: assume not caught up, show it
      const nextAiring   = media.nextAiringEpisode?.episode ?? null;
      const latestReleased = nextAiring != null
        ? nextAiring - 1          // currently airing
        : totalEps > 0
          ? totalEps              // finished, all eps out
          : null;                 // unknown — show it anyway

      // Skip if caught up with latest released episode
      if (latestReleased != null && progress >= latestReleased) return;
      const pct      = totalEps > 0 ? Math.min((progress / totalEps) * 100, 100) : 0;
      const epData   = epResults[idx]; // { number, name, still, overview, ... }

      // Use the episode thumbnail if available, else fall back to banner/cover
      const cover    = media.coverImage?.extraLarge || media.coverImage?.large || "";
      const banner   = media.bannerImage || cover;
      const thumbSrc = epData?.still ? epData.still : banner;
      const epName   = epData?.name || null;

      const isComplete = totalEps > 0 && progress >= totalEps;
      const epBadge    = isComplete
        ? "Completed"
        : `Ep ${nextEp}${totalEps ? ` / ${totalEps}` : ""}`;

      const card = document.createElement("div");
      card.className = "card cw";
      card.innerHTML = `
        <div class="card-thumb">
          <img src="${thumbSrc.startsWith("https://image.tmdb") ? `/api/proxy?url=${encodeURIComponent(thumbSrc)}` : px(thumbSrc)}" alt="${t}" loading="lazy" />
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

      card.addEventListener("mouseenter", () => {
        clearTimeout(_hoverTimer);
        _hoverTimer = setTimeout(() => activateCard(card, media), 420);
      });
      card.addEventListener("mouseleave", e => {
        if (e.relatedTarget === _expandEl || (_expandEl && _expandEl.contains(e.relatedTarget))) return;
        clearTimeout(_hoverTimer);
        _hoverTimer = setTimeout(clearActive, 100);
      });
      card.addEventListener("click", () => openModal(media));

      rail.appendChild(card);
    });

    // If everything was filtered out, hide the row
    if (rail.children.length === 0) {
      document.getElementById("row-continue").style.display = "none";
      return;
    }

    wireRailBtns();
  } catch (_) {
    // Launcher not running or user not logged in — silently skip
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════════
(async () => {
  skels("r-trending", 10);
  skels("r-popular",  10);
  skels("r-top",       10, "numbered");
  skels("r-airing",    8,  "wide");
  skels("r-movies",   10);

  wireRailBtns();

  // Run continue watching and main data in parallel
  const [cwResult, trending, popular, top, airing, movies] = await Promise.all([
    loadContinueWatching(),
    ...([
      gql("trending",      TTL.trending, `query{Page(perPage:20){media(sort:TRENDING_DESC,type:ANIME,isAdult:false){${F}}}}`),
      gql(`pop_${getSeason(new Date().getMonth())}_${new Date().getFullYear()}`, TTL.popular, `query($s:MediaSeason,$y:Int){Page(perPage:20){media(sort:POPULARITY_DESC,type:ANIME,season:$s,seasonYear:$y,isAdult:false){${F}}}}`, { s: getSeason(new Date().getMonth()), y: new Date().getFullYear() }),
      gql("top",           TTL.top,     `query{Page(perPage:20){media(sort:SCORE_DESC,type:ANIME,isAdult:false){${F}}}}`),
      gql("airing",        TTL.airing,  `query{Page(perPage:20){media(sort:TRENDING_DESC,type:ANIME,status:RELEASING,isAdult:false){${F}}}}`),
      gql("movies",        TTL.movies,  `query{Page(perPage:20){media(sort:POPULARITY_DESC,type:ANIME,format:MOVIE,isAdult:false){${F}}}}`),
    ])
  ]);

  const tList = trending?.Page?.media || [];

  _items = tList.slice(0, 6);
  buildDots();
  goHero(0);
  _timer = setInterval(() => goHero((_idx + 1) % _items.length), 7000);

  fillRail("r-trending", tList);
  fillRail("r-popular",  popular?.Page?.media || []);
  fillRail("r-top",      top?.Page?.media     || [], { numbered: true });
  fillRail("r-airing",   airing?.Page?.media  || [], { wide: true });
  fillRail("r-movies",   movies?.Page?.media  || []);

  wireRailBtns();
})();
