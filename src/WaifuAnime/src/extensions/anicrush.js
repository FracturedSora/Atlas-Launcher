// ══════════════════════════════════════════════════════════════════════════════
// AniCrush Extension (anicrush.to)
// ══════════════════════════════════════════════════════════════════════════════
const BASE_URL = "https://anicrush.to";
const API = "https://api.anicrush.to/shared/v2";
const UA  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0";
const BASE_HEADERS = {
  "User-Agent": UA,
  "Accept": "application/json",
  "Referer": `${BASE_URL}/`,
  "Origin": BASE_URL,
  "X-Site": "anicrush",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeTitle(title) {
  return (title || "")
    .toLowerCase()
    .replace(/(season|cour|part|uncensored)/g, "") // strip keywords
    .replace(/\d+(st|nd|rd|th)/g, (m) => m.replace(/st|nd|rd|th/, "")) // remove ordinal suffixes
    .replace(/[^a-z0-9]+/g, ""); // remove non-alphanumeric
}

// ── Decrypt helpers ───────────────────────────────────────────────────────────
async function extractMegaCloud(embedUrl) {
  const url = new URL(embedUrl);
  const baseDomain = `${url.protocol}//${url.host}/`;

  const headers = {
    "Accept": "*/*",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": baseDomain,
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
  };

  // Fetch embed page
  const html = await fetch(embedUrl, { headers }).then((r) => r.text());

  // Extract file ID
  const fileIdMatch = html.match(/<title>\s*File\s+#([a-zA-Z0-9]+)\s*-/i);
  if (!fileIdMatch) throw new Error("file_id not found in embed page");
  const fileId = fileIdMatch[1];

  // Extract nonce
  let nonce = null;
  const match48 = html.match(/\b[a-zA-Z0-9]{48}\b/);
  if (match48) nonce = match48[0];
  else {
    const match3x16 = [...html.matchAll(/["']([A-Za-z0-9]{16})["']/g)];
    if (match3x16.length >= 3) {
      nonce = match3x16[0][1] + match3x16[1][1] + match3x16[2][1];
    }
  }
  if (!nonce) throw new Error("nonce not found");

  // Fetch sources
  const sourcesJson = await fetch(`${baseDomain}embed-2/v3/e-1/getSources?id=${fileId}&_k=${nonce}`, { headers }).then((r) => r.json());

  return {
    sources: sourcesJson.sources,
    tracks: sourcesJson.tracks || [],
    intro: sourcesJson.intro || null,
    outro: sourcesJson.outro || null,
    server: sourcesJson.server || null,
  };
}

// ── Extension Object ──────────────────────────────────────────────────────────
const extension = {
  id: "anicrush",
  name: "AniCrush",
  url: BASE_URL,
  logo: `${BASE_URL}/favicon.ico`,
  supportsDub: true,
  episodeServers: ["Southcloud-1", "Southcloud-2", "Southcloud-3"],

  async search(query, dub = false) {
    // Handle either an object (from advanced wrappers) or a direct string
    const q = typeof query === "string" ? query : (query.query || "");
    const url = `${API}/movie/list?keyword=${encodeURIComponent(q)}&limit=48&page=1`;

    const html = await fetch(url, { headers: BASE_HEADERS }).then(r => r.json());

    let matches = html.result?.movies?.map((movie) => ({
      id: movie.id,
      pageUrl: movie.slug,
      title: movie.name_english || movie.name,
      titleJP: movie.name,
      dub: movie.has_dub,
    })) ?? [];

    if (!matches.length) return [];
    if (dub) matches = matches.filter(m => m.dub);

    const targetNorm = normalizeTitle(q);

    // Filter by loose title match
    matches = matches.filter(m => {
      const nEn = normalizeTitle(m.title);
      const nJp = normalizeTitle(m.titleJP);
      return nEn === targetNorm || nJp === targetNorm ||
             nEn.includes(targetNorm) || nJp.includes(targetNorm) ||
             targetNorm.includes(nEn) || targetNorm.includes(nJp);
    });

    // Sort by best fit
    matches.sort((a, b) => {
      const A = normalizeTitle(a.title);
      const B = normalizeTitle(b.title);
      if (A.length !== B.length) return A.length - B.length;
      return A.localeCompare(B);
    });

    return matches.map(m => ({
      id: `${m.id}?dub=${dub}`, // Same format as AnimeKai
      title: m.title,
      url: `${BASE_URL}/detail/${m.pageUrl}.${m.id}`,
      subOrDub: dub ? "dub" : "sub",
    }));
  },

  async findEpisodes(id) {
    const cleanId = id.split("?dub")[0];
    const dub = id.split("?dub=")[1] === "true";

    const epRes = await fetch(`${API}/episode/list?_movieId=${cleanId}`, { headers: BASE_HEADERS });
    const epJson = await epRes.json();

    const episodeGroups = epJson?.result ?? {};
    const episodes = [];

    for (const group of Object.values(episodeGroups)) {
      if (!Array.isArray(group)) continue;
      for (const ep of group) {
        episodes.push({
          id: `${cleanId}?dub=${dub}`,
          number: ep.number,
          title: ep.name_english || `Episode ${ep.number}`,
          url: "", // Not needed for AniCrush, server fetch relies on ID + Episode Number
        });
      }
    }

    return episodes.sort((a, b) => a.number - b.number);
  },

  async findEpisodeServer(episode, server = "Southcloud-1") {
    const cleanId = episode.id.split("?dub")[0];
    const isDub = episode.id.split("?dub=")[1] === "true";
    const subOrDub = isDub ? "dub" : "sub";

    const serverMap = {
      "Southcloud-1": 4,
      "Southcloud-2": 1,
      "Southcloud-3": 6,
    };

    const sv = serverMap[server] ?? 4;
    const encryptedLinkUrl = `${API}/episode/sources?_movieId=${cleanId}&ep=${episode.number}&sv=${sv}&sc=${subOrDub}`;

    try {
      // Fetch encrypted link
      const res = await fetch(encryptedLinkUrl, { headers: BASE_HEADERS });
      const json = await res.json();
      const encryptedIframe = json?.result?.link;

      if (!encryptedIframe) throw new Error("Missing encrypted iframe link");

      // Try primary decrypter
      let decryptData = null;
      try {
        decryptData = await extractMegaCloud(encryptedIframe);
      } catch (err) {
        console.warn("Primary decrypter failed:", err);
      }

      // Fallback to ShadeOfChaos if primary fails or no valid data
      if (!decryptData) {
        console.warn("Primary decrypter failed — trying ShadeOfChaos fallback...");
        const fallbackRes = await fetch(`https://ac-api.ofchaos.com/api/anime/embed/convert/v2?embedUrl=${encodeURIComponent(encryptedIframe)}`);
        decryptData = await fallbackRes.json();
      }

      if (!decryptData) throw new Error("No video sources from any decrypter");

      // Get HLS or MP4 stream
      const streamSource =
        decryptData.sources.find((s) => s.type === "hls") ||
        decryptData.sources.find((s) => s.type === "mp4");

      if (!streamSource?.file) throw new Error("No valid stream file found");

      // Map subtitles
      const subtitles = (decryptData.tracks || [])
        .filter((t) => t.kind === "captions")
        .map((track, index) => ({
          label: track.label || "Unknown",
          url: track.file,
          default: !!track.default,
        }));

      return {
        server,
        headers: {
          "Referer": "https://megacloud.club/",
          "Origin": "https://megacloud.club",
          "User-Agent": UA,
        },
        videoSources: [
          {
            quality: "Auto",
            url: streamSource.file,
            type: streamSource.type === "hls" ? "m3u8" : "mp4",
          },
        ],
        subtitleTracks: subtitles,
        hasDub: isDub,
        skipTimes: null
      };
    } catch (err) {
      console.warn(`Failed on ${server}`, err);
      throw new Error(`No stream found for ${server}`);
    }
  },
};

module.exports = extension;
