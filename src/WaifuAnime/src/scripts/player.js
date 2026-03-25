// ══════════════════════════════════════════════════════════════════════════════
// ATLAS PLAYER — Netflix-accurate
// ══════════════════════════════════════════════════════════════════════════════
(function () {
  "use strict";

  // ── DOM ───────────────────────────────────────────────────────────────────
  const overlay       = document.getElementById("player-overlay");
  const backBtn       = document.getElementById("player-back");
  const showTitleEl   = document.getElementById("player-show-title");
  const epTitleEl     = document.getElementById("player-ep-title");
  const ctrlTitleEl   = document.getElementById("player-ctrl-title");
  const qualBtn       = document.getElementById("player-quality-btn");
  const qualMenu      = document.getElementById("player-quality-menu");
  const extBtn        = document.getElementById("player-ext-btn");
  const extMenu       = document.getElementById("player-ext-menu");
  const retryBtn      = document.getElementById("player-retry");
  const errMsg        = document.getElementById("player-error-msg");
  const skipIntroBtn  = document.getElementById("player-skip-intro");
  const skipOutroBtn  = document.getElementById("player-skip-outro");
  const scrubber      = document.getElementById("player-scrubber");
  const scrubTrack    = document.getElementById("player-scrubber-track");
  const scrubFill     = document.getElementById("player-scrubber-fill");
  const scrubThumb    = document.getElementById("player-scrubber-thumb");
  const timeCur       = document.getElementById("player-time-cur");
  const timeDur       = document.getElementById("player-time-dur");
  const pPlay         = document.getElementById("pctrl-play");
  const pBack10       = document.getElementById("pctrl-back10");
  const pFwd10        = document.getElementById("pctrl-fwd10");
  const pVol          = document.getElementById("pctrl-vol");
  const pVolSlider    = document.getElementById("pctrl-vol-slider");
  const pFs           = document.getElementById("pctrl-fs");
  const pNext         = document.getElementById("pctrl-next");
  const pEpsBtn       = document.getElementById("pctrl-eps");
  const epsPanel      = document.getElementById("player-eps-panel");
  const epsList       = document.getElementById("player-eps-list");
  const epsCloseBtn   = document.getElementById("pctrl-eps-close");
  const subBtn        = document.getElementById("ptgl-sub");
  const dubBtn        = document.getElementById("ptgl-dub");
  const langWrap      = document.getElementById("player-lang-wrap");

  // ── State ─────────────────────────────────────────────────────────────────
  let _vjs          = null;
  let _ctrlTimer    = null;
  let _scrubbing    = false;
  let _pendingPlay  = null;
  let _sources      = [];
  let _skipTimes    = null;
  let _curEpNum     = null;
  let _tmdbEps      = [];
  let _extEps       = [];
  let _extId        = null;
  let _showTitle    = "";
  let _isDub        = false;
  let _hasDub       = false;
  let _malId        = null;
  let _extList      = [];

  // AniList Tracking State
  let _anilistId    = null;
  let _progressSaved = false;

  // ── Video.js ──────────────────────────────────────────────────────────────
  videojs.log.level('debug');
  function getVjs() {
    if (_vjs) return _vjs;
    _vjs = videojs("atlas-player", {
      controls: false, autoplay: false, preload: "auto", fluid: false, fill: true,
      html5: {
        vhs: { overrideNative: true, enableLowInitialPlaylist: true },
        nativeVideoTracks: false, nativeAudioTracks: false, nativeTextTracks: false,
      },
    });
    _vjs.on("timeupdate",      _onTime);
    _vjs.on("durationchange",  _onDur);
    _vjs.on("play",    () => { _setPlayIcon(false); overlay.classList.remove("loading"); });
    _vjs.on("pause",   () => { _setPlayIcon(true);  _showCtrl(); });
    _vjs.on("waiting", () => overlay.classList.add("loading"));
    _vjs.on("canplay", () => overlay.classList.remove("loading"));
    _vjs.on("ended", () => {
      _setPlayIcon(true);
      _showCtrl();
      // Auto-advance to next episode
      const idx = _extEps.findIndex(e => e.number === _curEpNum);
      if (idx >= 0 && idx < _extEps.length - 1) {
        setTimeout(() => _playExt(_extEps[idx + 1]), 1500);
      }
    });
    _vjs.on("error",   () => {
      const e = _vjs.error();
      _showError(e ? `Error ${e.code}: ${e.message}` : "Playback failed");
    });
    _vjs.on("volumechange", () => {
      const off = _vjs.muted() || _vjs.volume() === 0;
      pVol.querySelector(".icon-vol-up").style.display  = off ? "none" : "";
      pVol.querySelector(".icon-vol-off").style.display = off ? "" : "none";
      pVolSlider.value = _vjs.muted() ? 0 : _vjs.volume();
    });
    // fullscreenchange handled natively via document listener
    // Restore saved volume
    _vjs.ready(() => _loadVol());
    return _vjs;
  }

  // ── Controls visibility ───────────────────────────────────────────────────
  function _showCtrl() {
    overlay.classList.add("controls-on");
    clearTimeout(_ctrlTimer);
    _ctrlTimer = setTimeout(() => {
      if (_vjs && !_vjs.paused() && !epsPanel.classList.contains("open") && !qualMenu.classList.contains("open"))
        overlay.classList.remove("controls-on");
    }, 3500);
  }
  overlay.addEventListener("mousemove",  _showCtrl);
  overlay.addEventListener("touchstart", _showCtrl, { passive: true });
  overlay.addEventListener("click", e => {
    if (e.target.closest("button,select,input,.player-eps-panel,.player-quality-wrap,.player-skip-btn,.player-shelf,.player-topbar")) return;
    if (_vjs) _vjs.paused() ? _vjs.play() : _vjs.pause();
    _showCtrl();
  });

  // ── Time & Tracking ────────────────────────────────────────────────────────
  function _fmt(s) {
    if (!isFinite(s) || s < 0) return "0:00";
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), ss = Math.floor(s%60);
    return h ? `${h}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}` : `${m}:${String(ss).padStart(2,"0")}`;
  }

  function _onTime() {
    if (!_vjs || _scrubbing) return;
    const c = _vjs.currentTime(), d = _vjs.duration() || 0;
    const p = d > 0 ? (c / d) * 100 : 0;

    scrubFill.style.width  = p + "%";
    scrubThumb.style.left  = p + "%";
    timeCur.textContent    = _fmt(c);

    _checkSkip(c);
    _checkAniListTracking(p);
  }

  function _onDur() {
    if (!_vjs) return;
    timeDur.textContent = _fmt(_vjs.duration());
    _drawSkipMarkers(); // draw intro/outro segments once duration is known
  }

  // ── AniList Progress Tracking (80%) ───────────────────────────────────────
  async function _checkAniListTracking(percentage) {
    // If we've already saved for this episode, or if we don't have the AniList ID, abort
    if (_progressSaved || !_anilistId || !_curEpNum) return;

    if (percentage >= 80) {
      _progressSaved = true; // Lock it so it doesn't spam the API

      try {
        // Get the user's token
        const meRes = await fetch("/api/me");
        const me = await meRes.json();

        if (!me.success || !me.token) {
          console.warn("[Tracking] User not logged in, progress not saved to AniList.");
          return;
        }

        // Fire the GraphQL Mutation to AniList to save the progress
        const r = await fetch("https://graphql.anilist.co", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${me.token}`
          },
          body: JSON.stringify({
            query: `mutation($mediaId: Int, $progress: Int) {
              SaveMediaListEntry(mediaId: $mediaId, progress: $progress) {
                id
                progress
              }
            }`,
            variables: {
              mediaId: parseInt(_anilistId),
              progress: parseInt(_curEpNum)
            }
          })
        });

        const j = await r.json();
        if (j.data && j.data.SaveMediaListEntry) {
          console.log(`[Tracking] Successfully saved episode ${_curEpNum} to AniList!`);
        } else {
          console.warn("[Tracking] Failed to save progress:", j.errors);
        }

      } catch (err) {
        console.error("[Tracking] Error sending progress to AniList:", err);
      }
    }
  }

  // ── Scrubber ──────────────────────────────────────────────────────────────
  scrubber.addEventListener("mousedown", e => { _scrubbing = true; _doSeek(e); _showCtrl(); });
  document.addEventListener("mousemove", e => { if (_scrubbing) _doSeek(e); });
  document.addEventListener("mouseup",   () => { _scrubbing = false; });
  function _doSeek(e) {
    const r = scrubber.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    scrubFill.style.width = (p*100)+"%"; scrubThumb.style.left = (p*100)+"%";
    if (_vjs && _vjs.duration()) { _vjs.currentTime(_vjs.duration()*p); timeCur.textContent = _fmt(_vjs.duration()*p); }
  }

  // ── Skip intro/outro ──────────────────────────────────────────────────────
  function _drawSkipMarkers() {
    if (scrubTrack) scrubTrack.querySelectorAll(".player-skip-marker").forEach(m => m.remove());
    if (!_skipTimes || !_vjs || !scrubTrack) return;
    const dur = _vjs.duration();
    if (!dur || dur <= 0) return;

    ["intro", "outro"].forEach(key => {
      const seg = _skipTimes[key];
      if (!seg || seg.start == null || seg.end == null) return;
      const left  = Math.max(0, (seg.start / dur) * 100);
      const width = Math.max(0.5, ((seg.end - seg.start) / dur) * 100);
      const el    = document.createElement("div");
      el.className = `player-skip-marker ${key}`;
      el.style.left  = left + "%";
      el.style.width = width + "%";
      scrubTrack.appendChild(el);
    });
  }

  function _checkSkip(c) {
    if (!_skipTimes) {
      skipIntroBtn.classList.remove("visible");
      skipOutroBtn.classList.remove("visible");
      return;
    }
    const inI = _skipTimes.intro && c >= _skipTimes.intro.start && c < _skipTimes.intro.end;
    const inO = _skipTimes.outro && c >= _skipTimes.outro.start && c < _skipTimes.outro.end;
    skipIntroBtn.classList.toggle("visible", !!inI);
    skipOutroBtn.classList.toggle("visible", !!inO);
  }
  skipIntroBtn.addEventListener("click", () => { if (_vjs && _skipTimes?.intro) _vjs.currentTime(_skipTimes.intro.end); });
  skipOutroBtn.addEventListener("click", () => { if (_vjs && _skipTimes?.outro) _vjs.currentTime(_skipTimes.outro.end); });

  // ── Play icon ─────────────────────────────────────────────────────────────
  function _setPlayIcon(paused) {
    pPlay.querySelector(".icon-play").style.display  = paused ? "" : "none";
    pPlay.querySelector(".icon-pause").style.display = paused ? "none" : "";
  }

  // ── Button wiring ─────────────────────────────────────────────────────────
  pPlay.addEventListener("click",    () => { if (_vjs) _vjs.paused() ? _vjs.play() : _vjs.pause(); });
  pBack10.addEventListener("click", () => { if (_vjs) _vjs.currentTime(Math.max(0, _vjs.currentTime()-10)); });
  pFwd10.addEventListener("click",  () => { if (_vjs) _vjs.currentTime(_vjs.currentTime()+10); });
  pVol.addEventListener("click",    () => { if (_vjs) { _vjs.muted(!_vjs.muted()); _saveVol(); } });
  pVolSlider.addEventListener("input", () => { if (_vjs) { _vjs.volume(+pVolSlider.value); _vjs.muted(false); _saveVol(); } });

  function _saveVol() {
    try { localStorage.setItem("atlas_vol", JSON.stringify({ v: _vjs.volume(), m: _vjs.muted() })); } catch(_) {}
  }
  function _loadVol() {
    try {
      const d = JSON.parse(localStorage.getItem("atlas_vol"));
      if (d && _vjs) { _vjs.volume(d.v ?? 1); _vjs.muted(!!d.m); pVolSlider.value = d.m ? 0 : (d.v ?? 1); }
    } catch(_) {}
  }
  pFs.addEventListener("click", () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const req = overlay.requestFullscreen || overlay.webkitRequestFullscreen;
      if (req) req.call(overlay);
    }
    setTimeout(_showCtrl, 150);
  });

  document.addEventListener("fullscreenchange",       _onFsChange);
  document.addEventListener("webkitfullscreenchange", _onFsChange);
  function _onFsChange() {
    const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    pFs.querySelector(".icon-fs-enter").style.display = fs ? "none" : "";
    pFs.querySelector(".icon-fs-exit").style.display  = fs ? "" : "none";
    _showCtrl();
  }

  // Quality dropdown
  qualBtn.addEventListener("click", e => {
    e.stopPropagation();
    qualMenu.classList.toggle("open");
    epsPanel.classList.remove("open");
  });
  document.addEventListener("click", e => {
    if (!qualMenu.contains(e.target) && e.target !== qualBtn) qualMenu.classList.remove("open");
  });

  function _buildQualMenu() {
    qualMenu.innerHTML = "";
    _sources.forEach(s => {
      const opt = document.createElement("div");
      opt.className = "player-quality-opt" + (s.quality === _sources[0].quality ? " active" : "");
      opt.textContent = s.quality;
      opt.addEventListener("click", () => {
        if (!_vjs) return;
        const t = _vjs.currentTime();
        _vjs.src({ src: s.url, type: "application/vnd.apple.mpegurl" });
        _vjs.one("canplay", () => { _vjs.currentTime(t); _vjs.play(); });
        qualBtn.textContent = s.quality;
        qualMenu.querySelectorAll(".player-quality-opt").forEach(o => o.classList.toggle("active", o.textContent === s.quality));
        qualMenu.classList.remove("open");
      });
      qualMenu.appendChild(opt);
    });
    qualBtn.textContent = _sources[0]?.quality || "Auto";
  }

  // Extension selector
  extBtn.addEventListener("click", e => {
    e.stopPropagation();
    extMenu.classList.toggle("open");
    qualMenu.classList.remove("open");
    epsPanel.classList.remove("open");
  });
  document.addEventListener("click", e => {
    if (!extMenu.contains(e.target) && e.target !== extBtn) extMenu.classList.remove("open");
  });

  async function _loadExtensions() {
    try {
      const exts = await fetch("/api/extensions").then(r => r.json());
      _extList = exts;
      extMenu.innerHTML = "";
      exts.forEach(ext => {
        const opt = document.createElement("div");
        opt.className = "player-quality-opt" + (ext.id === _extId ? " active" : "");
        opt.textContent = ext.name;
        opt.addEventListener("click", async () => {
          if (ext.id === _extId) { extMenu.classList.remove("open"); return; }
          extMenu.classList.remove("open");
          extBtn.textContent = ext.name;
          extMenu.querySelectorAll(".player-quality-opt").forEach(o => o.classList.toggle("active", o.textContent === ext.name));

          _extId = ext.id;
          const t = _vjs ? _vjs.currentTime() : 0;
          overlay.classList.add("loading");

          try {
            const searchRes = await fetch(`/api/ext/${ext.id}/search?q=${encodeURIComponent(_showTitle)}`).then(r => r.json());
            if (!searchRes.length) throw new Error("Show not found on " + ext.name);
            const newShowId = searchRes[0].id;
            const newEps    = await fetch(`/api/ext/${ext.id}/episodes?showId=${encodeURIComponent(newShowId)}`).then(r => r.json());
            const normalised = Array.isArray(newEps) ? newEps : (newEps?.episodes || []);
            if (!normalised.length) throw new Error("No episodes on " + ext.name);

            _extEps = normalised;
            const ep = normalised.find(e => e.number === _curEpNum) || normalised[0];
            await _playExt(ep, t);
          } catch (e) {
            console.error("[ext switch]", e.message);
            overlay.classList.remove("loading");
          }
        });
        extMenu.appendChild(opt);
      });
      extBtn.textContent = exts.find(e => e.id === _extId)?.name || "Source";
    } catch (_) {}
  }

  // Episodes panel
  pEpsBtn.addEventListener("click",      () => { epsPanel.classList.toggle("open"); qualMenu.classList.remove("open"); extMenu.classList.remove("open"); });
  epsCloseBtn.addEventListener("click", () => epsPanel.classList.remove("open"));

  // Sub/Dub
  subBtn.addEventListener("click", () => { if (_isDub) { _isDub=false; _setLang(); _reloadLang(); } });
  dubBtn.addEventListener("click", () => { if (!_isDub && _hasDub) { _isDub=true; _setLang(); _reloadLang(); } });

  function _setLang() {
    subBtn.classList.toggle("active", !_isDub);
    dubBtn.classList.toggle("active",  _isDub);
  }

  async function _reloadLang() {
    if (!_pendingPlay) return;
    const t = _vjs ? _vjs.currentTime() : 0;
    await _playExt(_pendingPlay.episode, t);
  }

  // Next episode
  pNext.addEventListener("click", () => {
    const idx = _extEps.findIndex(e => e.number === _curEpNum);
    if (idx >= 0 && idx < _extEps.length-1) _playExt(_extEps[idx+1]);
  });

  // Keyboard
  document.addEventListener("keydown", e => {
    if (!overlay.classList.contains("open")) return;
    switch (e.key) {
      case "Escape":      e.preventDefault(); closePlayer(); break;
      case " ": case "k": e.preventDefault(); if (_vjs) _vjs.paused() ? _vjs.play() : _vjs.pause(); break;
      case "ArrowRight":  e.preventDefault(); if (_vjs) _vjs.currentTime(_vjs.currentTime()+10); break;
      case "ArrowLeft":   e.preventDefault(); if (_vjs) _vjs.currentTime(Math.max(0,_vjs.currentTime()-10)); break;
      case "f":           e.preventDefault(); pFs.click(); break;
      case "m":           e.preventDefault(); if (_vjs) _vjs.muted(!_vjs.muted()); break;
    }
    _showCtrl();
  });

  // Back
  backBtn.addEventListener("click", closePlayer);

  // ── Error ─────────────────────────────────────────────────────────────────
  function _showError(msg) {
    overlay.classList.remove("loading"); overlay.classList.add("errored");
    if (errMsg) errMsg.textContent = msg || "Playback failed.";
  }
  retryBtn.addEventListener("click", () => {
    if (_pendingPlay) { overlay.classList.remove("errored"); _playExt(_pendingPlay.episode); }
  });

  // ── Episode panel ─────────────────────────────────────────────────────────
  function _buildEpsPanel(cur) {
    epsList.innerHTML = "";
    const list = _tmdbEps.length ? _tmdbEps : _extEps.map(e => ({ number: e.number, name: e.title, still: null }));
    list.forEach(ep => {
      const el = document.createElement("div");
      el.className = "player-ep-item" + (ep.number === cur ? " playing" : "");
      el.innerHTML = `
        <div class="player-ep-item-num">${ep.number}</div>
        <div class="player-ep-item-thumb">${ep.still ? `<img src="/api/proxy?url=${encodeURIComponent(ep.still)}" loading="lazy"/>` : ""}</div>
        <div class="player-ep-item-info">
          <div class="player-ep-item-title">${ep.name || `Episode ${ep.number}`}</div>
          <div class="player-ep-item-sub">Episode ${ep.number}</div>
        </div>`;
      el.addEventListener("click", () => {
        epsPanel.classList.remove("open");
        const extEp = _extEps.find(e => e.number === ep.number);
        if (extEp) _playExt(extEp);
      });
      epsList.appendChild(el);
    });
    const active = epsList.querySelector(".playing");
    if (active) setTimeout(() => active.scrollIntoView({ block: "center", behavior: "smooth" }), 120);
  }

  // ── Core play ─────────────────────────────────────────────────────────────
  async function _playExt(episode, resumeAt = 0) {
    if (!_extId) return;

    _curEpNum    = episode.number;
    _pendingPlay = { ..._pendingPlay, episode };

    // Reset the tracker flag since this is a new episode load
    _progressSaved = false;

    overlay.classList.add("open", "loading");
    overlay.classList.remove("errored");
    epTitleEl.textContent   = episode.title || `Episode ${episode.number}`;
    ctrlTitleEl.textContent = `${_showTitle} · ${episode.title || `Episode ${episode.number}`}`;
    _showCtrl();

    const epWithDub = { ...episode, url: episode.url.replace(/\?dub=\w+/, `?dub=${_isDub}`) };

    try {
      const res = await fetch(`/api/ext/${_extId}/server`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episode: epWithDub, server: "Server 1" }),
      });

      if (!res.ok) throw new Error(`Server Error: ${res.status}`);

      const data = await res.json();
      if (!data.videoSources?.length) throw new Error("No video sources found");

      // Set up the headers query string for the proxy if referer exists
      const refererStr = data.proxyReferer || (data.headers && (data.headers.Referer || data.headers.referer)) || null;
      let headersQuery = "";
      if (refererStr) {
        headersQuery = `&headers=${encodeURIComponent(JSON.stringify({ Referer: refererStr }))}`;
      }

      // Add cache buster
      const bust = `&t=${Date.now()}`;

      _sources = data.videoSources
        .sort((a,b) => (parseInt(b.quality)||0) - (parseInt(a.quality)||0))
        .map(s => {
          return {
            ...s,
            url: `/api/v1/proxy?url=${encodeURIComponent(s.url)}${headersQuery}${bust}`
          };
        });

      _hasDub = data.hasDub ?? true;
      dubBtn.style.opacity = _hasDub ? "1" : "0.3";
      dubBtn.style.pointerEvents = _hasDub ? "" : "none";
      _buildQualMenu();

      const vjs = getVjs();

      vjs.src({ src: _sources[0].url, type: "application/vnd.apple.mpegurl" });

      vjs.one("canplay", () => {
        overlay.classList.remove("loading");
        if (resumeAt > 0) vjs.currentTime(resumeAt);
        vjs.play().catch(err => console.warn("[player] Autoplay blocked or failed", err));
      });

      if (data.subtitleTracks?.length) {
        data.subtitleTracks.forEach(t => {
          vjs.addRemoteTextTrack({
            kind: "subtitles",
            label: t.label,
            src: t.url,
            default: !!t.default
          }, false);
        });
      }

      _skipTimes = null;
      _drawSkipMarkers();

      if (_malId) {
        fetch(`/api/aniskip/${_malId}/${episode.number}`)
          .then(r => r.json())
          .then(sk => {
            if (sk.found) {
              _skipTimes = { intro: sk.intro, outro: sk.outro };
              if (vjs.duration() > 0) {
                _drawSkipMarkers();
                _checkSkip(vjs.currentTime());
              }
            }
          })
          .catch(e => console.error("[aniskip] error:", e));
      }

      _buildEpsPanel(_curEpNum);

    } catch (e) {
      console.error("[player] Critical Playback Error:", e.message);
      _showError(e.message);
    }
  }

  // ── Close ─────────────────────────────────────────────────────────────────
  function closePlayer() {
    overlay.classList.remove("open","loading","errored","controls-on");
    epsPanel.classList.remove("open");
    qualMenu.classList.remove("open");
    extMenu.classList.remove("open");
    if (_vjs) {
      _vjs.pause();
      _vjs.reset();
    }
    skipIntroBtn.classList.remove("visible");
    skipOutroBtn.classList.remove("visible");
    if (scrubTrack) scrubTrack.querySelectorAll(".player-skip-marker").forEach(m => m.remove());
    _sources=[]; _skipTimes=null; _pendingPlay=null; _curEpNum=null; _extEps=[]; _tmdbEps=[];
    _progressSaved=false; _anilistId=null;
    scrubFill.style.width="0%"; scrubThumb.style.left="0%";
    timeCur.textContent="0:00"; timeDur.textContent="0:00";
    clearTimeout(_ctrlTimer);

    // Clear out the AniList caches when closing player so rows update immediately
    try {
        const keys = Object.keys(sessionStorage);
        keys.forEach(k => {
            if (k.startsWith("as3_cw_") || k.startsWith("as3_mylist_")) {
                sessionStorage.removeItem(k);
            }
        });
    } catch (_) {}
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function openLoading(showTitleText, epTitleText) {
    overlay.classList.add("open","loading");
    overlay.classList.remove("errored","controls-on");
    showTitleEl.textContent = showTitleText || "";
    epTitleEl.textContent   = epTitleText   || "";
    ctrlTitleEl.textContent = showTitleText || "";
    qualMenu.innerHTML = ""; qualBtn.textContent = "Auto";
    _loadExtensions();
    _showCtrl();
  }

  async function playEpisode(extId, showTitleText, extEpisodes, targetEpNum, tmdbEpisodes=[], isDub=false, malId=null, anilistId=null) {
    _extId      = extId;
    _showTitle  = showTitleText;
    _extEps     = extEpisodes;
    _tmdbEps    = tmdbEpisodes;
    _isDub      = isDub;
    _malId      = malId;
    _anilistId  = anilistId;

    showTitleEl.textContent = showTitleText;
    _setLang();
    _buildEpsPanel(targetEpNum);
    const ep = extEpisodes.find(e => e.number === targetEpNum) || extEpisodes[0];
    if (!ep) { _showError("Episode not found"); return; }
    _pendingPlay = { extId, episode: ep };
    await _playExt(ep);
  }

  window.AtlasPlayer = { openLoading, playEpisode, closePlayer, showError: _showError };

})();
