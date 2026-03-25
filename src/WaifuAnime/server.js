const Fastify = require("fastify");
const path = require("path");
const fs = require("fs");
const { Readable } = require("stream");

// Load .env before anything else reads process.env
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { loadExtensions, getExtension, listExtensions } = require("./loader");

const PORT    = process.env.PORT || 3002;
const fastify = Fastify({ logger: false });

// ── Static: src/scripts → /scripts/
fastify.register(require("@fastify/static"), {
  root:   path.join(__dirname, "src", "scripts"),
  prefix: "/scripts/",
});

// ── Static: src/styles → /styles/
fastify.register(require("@fastify/static"), {
  root:          path.join(__dirname, "src", "styles"),
  prefix:        "/styles/",
  decorateReply: false,
});

// ── Static: node_modules/video.js/dist → /videojs/
fastify.register(require("@fastify/static"), {
  root:          path.join(__dirname, "node_modules", "video.js", "dist"),
  prefix:        "/videojs/",
  decorateReply: false,
});

// ── Home page
fastify.get("/", async (req, reply) => {
  const html = fs.readFileSync(
    path.join(__dirname, "src", "views", "home.html"),
    "utf-8"
  );
  reply.type("text/html").send(html);
});

fastify.get("/list", async (req, reply) => {
  const html = fs.readFileSync(
    path.join(__dirname, "src", "views", "mylist.html"),
    "utf-8"
  );
  reply.type("text/html").send(html);
});

// ── Image proxy — fetches images server-side to avoid hotlink/CORS blocks
fastify.get("/api/proxy", async (req, reply) => {
  const url = req.query.url;
  if (!url) return reply.status(400).send("Missing url");
  try {
    const res = await fetch(url, {
      headers: {
        "Referer":    "https://anilist.co",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });
    if (!res.ok) return reply.status(res.status).send("Upstream error");
    const buf  = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") || "image/jpeg";
    reply
      .header("Content-Type", type)
      .header("Cache-Control", "public, max-age=86400")
      .send(buf);
  } catch (e) {
    reply.status(500).send(e.message);
  }
});

// ── Favicon (prevent 404 spam)
fastify.get("/favicon.ico", (req, reply) => reply.status(204).send());

// ── M3U8 / HLS proxy ─────────────────────────────────────────────────────────
fastify.all("/api/v1/proxy", async (req, reply) => {
  const targetUrl = req.query.url;
  const headersParam = req.query.headers;
  const authToken = req.query.token;

  if (!targetUrl) return reply.status(400).send("Missing url parameter");

  try {
    let fetchHeaders = {};

    if (headersParam) {
      try { fetchHeaders = JSON.parse(headersParam); }
      catch (err) { /* ignore parse errors */ }
    }

    fetchHeaders['Accept'] = '*/*';
    if (req.headers['range']) {
      fetchHeaders['Range'] = req.headers['range'];
    }

    if (!fetchHeaders['User-Agent'] && !fetchHeaders['user-agent']) {
      fetchHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }

    // Strip host so fetch assigns the correct one for the target
    delete fetchHeaders['host'];
    delete fetchHeaders['Host'];

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: fetchHeaders
    });

    // Copy response headers (excluding Content-Length)
    // List of headers we MUST NOT copy from the upstream server
        const forbiddenHeaders = [
          'content-length',
          'content-encoding', // Prevents double-decompression corruption
          'access-control-allow-origin', // Prevents CORS conflicts
          'access-control-allow-methods',
          'access-control-allow-headers',
          'access-control-allow-credentials',
          'cross-origin-resource-policy',
          'cross-origin-opener-policy'
        ];

        // Copy safe response headers
        response.headers.forEach((value, key) => {
          if (!forbiddenHeaders.includes(key.toLowerCase())) {
            reply.header(key, value);
          }
        });

        // NOW we safely set our own CORS headers
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');

    if (req.method === 'HEAD') {
      return reply.status(200).send();
    }

    const contentType = response.headers.get('content-type') || '';
    const urlWithoutQuery = targetUrl.split('?')[0].toLowerCase(); // Strip the ?token=...

    const isHlsPlaylist = urlWithoutQuery.endsWith('.m3u8') || contentType.toLowerCase().includes('mpegurl');

    // If it's a video chunk (.ts, .mp4), stream it directly!
    if (!isHlsPlaylist) {
      reply.status(response.status);
      if (response.body) {
        // Fastify natively supports sending Node streams
        return reply.send(Readable.fromWeb(response.body));
      } else {
        return reply.send();
      }
    }

    // If it IS a playlist, read text and rewrite
    const bodyText = await response.text();
    const rewrittenPlaylist = rewritePlaylist(bodyText, targetUrl, headersParam, authToken);
    const payloadBuffer = Buffer.from(rewrittenPlaylist, 'utf-8');

    reply.header('Content-Type', 'application/vnd.apple.mpegurl');
    reply.header('Content-Length', payloadBuffer.length);
    if (!response.headers.has('cache-control')) {
      reply.header('Cache-Control', 'no-cache');
    }

    return reply.status(response.status).send(payloadBuffer);

  } catch (err) {
    console.error("[HLS-PROXY] Error:", err.message);
    return reply.status(500).send("Proxy request failed");
  }
});

// ── Playlist Rewriter Helpers ──
function rewritePlaylist(playlistStr, baseUrl, headersParam, authToken) {
  const lines = playlistStr.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      if (line.includes('URI="')) {
        lines[i] = line.replace(/URI="([^"]+)"/g, (match, p1) => {
          return `URI="${rewriteURI(p1, baseUrl, headersParam, authToken)}"`;
        });
      }
    } else {
      lines[i] = rewriteURI(line, baseUrl, headersParam, authToken);
    }
  }
  return lines.join('\n');
}

function rewriteURI(uri, baseUrl, headersParam, authToken) {
  if (!uri || isAlreadyProxied(uri)) return uri;

  let resolvedUrl = uri;
  if (!uri.startsWith('http')) {
    try {
      resolvedUrl = new URL(uri, baseUrl).href;
    } catch (e) {
      resolvedUrl = uri; // Fallback
    }
  }
  return toProxyURL(resolvedUrl, headersParam, authToken);
}

function toProxyURL(targetMediaURL, headersParam, authToken) {
  let proxyURL = `/api/v1/proxy?url=${encodeURIComponent(targetMediaURL)}`;
  if (headersParam && headersParam !== "{}" && headersParam.length > 2) {
    proxyURL += `&headers=${encodeURIComponent(headersParam)}`;
  }
  if (authToken) {
    proxyURL += `&token=${encodeURIComponent(authToken)}`;
  }
  return proxyURL;
}

function isAlreadyProxied(url) {
  return url.includes('/api/v1/proxy?url=') || url.includes(encodeURIComponent('/api/v1/proxy?url='));
}

// ── Legacy wrappers (prevents your frontend breaking if still using old paths) ──
function b64urlSafeDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  try { return Buffer.from(str, 'base64').toString('utf8'); } catch { return ''; }
}

fastify.get("/api/proxy/hls/:targetB64", async (req, reply) => {
  const targetUrl = b64urlSafeDecode(req.params.targetB64);
  const ref = req.query.ref ? b64urlSafeDecode(req.query.ref) : null;
  const headersObj = ref ? { Referer: ref, Origin: req.query.ori || null } : {};
  const redirectUrl = toProxyURL(targetUrl, JSON.stringify(headersObj), "");
  return reply.redirect(302, redirectUrl);
});

fastify.get("/api/proxy/m3u8", async (req, reply) => {
  const url = req.query.url;
  if (!url) return reply.status(400).send("Missing ?url=");
  return reply.redirect(302, toProxyURL(url, "", ""));
});

// ── Launcher AniList me proxy — avoids CORS since localhost:3000 doesn't allow cross-origin
fastify.get("/api/me", async (req, reply) => {
  try {
    const res  = await fetch("http://localhost:3000/api/v1/anilist/me");
    const data = await res.json();
    reply.send(data);
  } catch (_) {
    // Launcher not running — return not logged in
    reply.send({ success: false });
  }
});

// ── AniSkip — fetch op/ed skip times by MAL ID + episode number
fastify.get("/api/aniskip/:malId/:episode", async (req, reply) => {
  const { malId, episode } = req.params;
  console.log(`[aniskip] fetching malId=${malId} ep=${episode}`);

  if (!malId || malId === "null" || malId === "undefined") {
    console.warn("[aniskip] invalid malId:", malId);
    return reply.send({ found: false, intro: null, outro: null });
  }

  try {
    // Exact format from AniSkip library source
    const url = `https://api.aniskip.com/v2/skip-times/${malId}/${episode}?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&types[]=recap&episodeLength=0`;
    console.log(`[aniskip] GET ${url}`);

    const res  = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
      }
    });
    const raw  = await res.text();
    console.log(`[aniskip] response ${res.status}: ${raw.substring(0, 200)}`);

    const data = JSON.parse(raw);

    if (!data.found || !data.results?.length) {
      return reply.send({ found: false, intro: null, outro: null });
    }

    let intro = null, outro = null;
    for (const r of data.results) {
      const st = r.skipType;
      if (st === "op" || st === "mixed-op") {
        intro = { start: r.interval.startTime, end: r.interval.endTime };
      }
      if (st === "ed" || st === "mixed-ed") {
        outro = { start: r.interval.startTime, end: r.interval.endTime };
      }
    }

    console.log(`[aniskip] found — intro=${JSON.stringify(intro)} outro=${JSON.stringify(outro)}`);
    reply.send({ found: true, intro, outro });

  } catch (e) {
    console.error("[aniskip] error:", e.message);
    reply.send({ found: false, intro: null, outro: null });
  }
});

// ── AniList proxy — forwards Authorization header so mutations work
fastify.post("/api/anilist", async (req, reply) => {
  try {
    const headers = { "Content-Type": "application/json", "Accept": "application/json" };
    // Pass through the bearer token if the client sent one
    const auth = req.headers["authorization"];
    if (auth) headers["Authorization"] = auth;
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers,
      body: JSON.stringify(req.body),
    });
    const data = await res.json();
    reply.send(data);
  } catch (e) {
    reply.status(500).send({ error: e.message });
  }
});

// ── TMDB episode data ────────────────────────────────────────────────────────
// Strategy (same as Seanime/Jellyfin):
//  1. ARM API (arm.haglund.dev) — look up AniList ID → TMDB show ID
//  2. Once we have the TMDB show, find which season matches by comparing
//     the AniList entry's start date and episode count against each season
//  3. Return ONLY that season's episodes, renumbered 1..N

const _tmdbCache = new Map();
const TMDB_TTL   = 6 * 60 * 60 * 1000;

// Clear on startup
_tmdbCache.clear();
console.log("[cache] Episode cache cleared on startup");

async function tmdbFetch(path, key) {
  const isBearer = key.length > 50;
  const url      = isBearer
    ? `https://api.themoviedb.org/3${path}`
    : `https://api.themoviedb.org/3${path}${path.includes("?") ? "&" : "?"}api_key=${key}`;
  const headers  = isBearer ? { Authorization: `Bearer ${key}` } : {};
  const res      = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TMDB ${res.status} ${path}`);
  return res.json();
}

// ARM API — maps AniList ID → TMDB show ID (run by the community, very reliable)
async function armLookup(anilistId) {
  try {
    const res  = await fetch(`https://arm.haglund.dev/api/v2/ids?source=anilist&id=${anilistId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.themoviedb ? String(data.themoviedb) : null;
  } catch (_) { return null; }
}

// Find the best matching season AND slice it to exactly the right episodes.
// TMDB often puts multiple AniList "cours" in one season (e.g. Frieren S1 on
// TMDB has 28 episodes but AniList splits it into cours of 16 and 12).
// We use the AniList start date to find the first matching episode, then
// take exactly `media.episodes` from that point.
async function findMatchingEpisodes(tmdbShowId, media, key) {
  const show       = await tmdbFetch(`/tv/${tmdbShowId}`, key);
  const numSeasons = show.number_of_seasons || 1;
  const alYear     = media.startDate?.year;
  const alMonth    = media.startDate?.month || 1;
  const alEps      = media.episodes || 0;
  const alStart    = alYear ? new Date(alYear, alMonth - 1, 1) : null;

  // Fetch all non-special seasons in parallel
  const fetches = [];
  for (let s = 1; s <= numSeasons; s++) {
    fetches.push(tmdbFetch(`/tv/${tmdbShowId}/season/${s}`, key).catch(() => null));
  }
  const seasons = (await Promise.all(fetches)).filter(s => s && s.season_number > 0 && s.episodes?.length);

  // Flatten ALL episodes across all seasons into one list with absolute ordering
  const allEps = [];
  for (const season of seasons) {
    for (const ep of season.episodes) {
      allEps.push(ep);
    }
  }

  if (!allEps.length) return [];

  // Find the starting episode — the one whose air date is closest to AniList start
  let startIdx = 0;
  if (alStart) {
    let bestDiff = Infinity;
    allEps.forEach((ep, i) => {
      if (!ep.air_date) return;
      const diff = Math.abs(new Date(ep.air_date) - alStart);
      if (diff < bestDiff) { bestDiff = diff; startIdx = i; }
    });
  }

  // Slice exactly `alEps` episodes from the start index
  // If AniList doesn't know the count (ongoing), take the whole season from startIdx
  const slice = alEps > 0
    ? allEps.slice(startIdx, startIdx + alEps)
    : allEps.slice(startIdx);

  return slice.map((ep, i) => ({
    number:   i + 1,
    name:     ep.name,
    overview: ep.overview,
    airDate:  ep.air_date,
    runtime:  ep.runtime,
    still:    ep.still_path ? `https://image.tmdb.org/t/p/w400${ep.still_path}` : null,
  }));
}

fastify.get("/api/episodes/:anilistId", async (req, reply) => {
  const KEY = process.env.TMDB_API_KEY;
  if (!KEY) return reply.send({ episodes: [], error: "TMDB_API_KEY not set in .env" });

  const { anilistId } = req.params;

  // Cache hit
  const hit = _tmdbCache.get(anilistId);
  if (hit && Date.now() < hit.expires) {
    return reply.header("X-Cache", "HIT").send({ episodes: hit.episodes });
  }

  try {
    // ── 1. AniList metadata ────────────────────────────────────────────────
    const alRes = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($id:Int){Media(id:$id,type:ANIME){
          idMal title{english romaji native} episodes format
          startDate{year month} synonyms
        }}`,
        variables: { id: parseInt(anilistId) }
      })
    });
    const media = (await alRes.json())?.data?.Media;
    if (!media) return reply.send({ episodes: [] });

    const label = media.title.english || media.title.romaji;
    console.log(`[episodes] Looking up "${label}" (AniList:${anilistId})`);

    // ── 2. ARM lookup — AniList ID → TMDB show ID ─────────────────────────
    let tmdbShowId = await armLookup(anilistId);

    // ── 3. Fallback: title search if ARM has no entry ──────────────────────
    if (!tmdbShowId) {
      console.log(`[episodes] ARM miss — falling back to title search for "${label}"`);

      const stripSuffix = t => t
        ?.replace(/\s*(season|part|cour|s)\s*\d+\s*$/gi, "")
        ?.replace(/\s+\d+(st|nd|rd|th)\s+season\s*$/gi, "")
        ?.trim();

      const candidates = [...new Set([
        media.title.english,
        media.title.romaji,
        stripSuffix(media.title.english),
        stripSuffix(media.title.romaji),
        ...(media.synonyms || []).slice(0, 2),
      ].filter(Boolean))];

      const year    = media.startDate?.year;
      let bestShow  = null;
      let bestDiff  = Infinity;

      for (const q of candidates) {
        const results = await Promise.allSettled([
          year ? tmdbFetch(`/search/tv?query=${encodeURIComponent(q)}&first_air_date_year=${year}`, KEY) : null,
          tmdbFetch(`/search/tv?query=${encodeURIComponent(q)}`, KEY),
        ].filter(Boolean));

        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          for (const show of (r.value.results || []).slice(0, 5)) {
            const showYear = parseInt(show.first_air_date?.slice(0, 4)) || 0;
            const diff     = year ? Math.abs(showYear - year) : 5;
            if (diff < bestDiff) { bestDiff = diff; bestShow = show; }
          }
        }
        if (bestDiff === 0) break;
      }

      if (bestShow) {
        tmdbShowId = String(bestShow.id);
        console.log(`[episodes] Title search matched "${bestShow.name}" (tmdb:${tmdbShowId}, yearDiff:${bestDiff})`);
      }
    } else {
      console.log(`[episodes] ARM matched "${label}" → tmdb:${tmdbShowId}`);
    }

    if (!tmdbShowId) {
      console.log(`[episodes] No TMDB match for "${label}"`);
      _tmdbCache.set(anilistId, { episodes: [], expires: Date.now() + TMDB_TTL });
      return reply.send({ episodes: [] });
    }

    // ── 4. Find and slice the exact episodes for this AniList entry ──────────
    // findMatchingEpisodes flattens all seasons, finds the start episode by
    // air date proximity, then takes exactly media.episodes from that point.
    const episodes = await findMatchingEpisodes(tmdbShowId, media, KEY);

    console.log(`[episodes] Returning ${episodes.length} eps for "${label}" (tmdb:${tmdbShowId})`);

    _tmdbCache.set(anilistId, { episodes, expires: Date.now() + TMDB_TTL });
    reply.header("X-Cache", "MISS").send({ episodes });

  } catch (e) {
    console.error("[episodes]", e.message);
    reply.status(500).send({ error: e.message });
  }
});


// ── Extension API routes ─────────────────────────────────────────────────────

// List all loaded extensions
fastify.get("/api/extensions", async (req, reply) => {
  reply.send(listExtensions());
});

// Debug: confirm extension loaded and can be called
fastify.get("/api/ext/ping", async (req, reply) => {
  reply.send({ extensions: listExtensions().map(e => e.id), ok: true });
});

// Search within an extension
fastify.get("/api/ext/:id/search", async (req, reply) => {
  const ext = getExtension(req.params.id);
  if (!ext) return reply.status(404).send({ error: "Extension not found" });
  try {
    const results = await ext.search(req.query.q || "", req.query.dub === "true");
    reply.send(results);
  } catch (e) {
    reply.status(500).send({ error: e.message });
  }
});

// Get episodes for a show
fastify.get("/api/ext/:id/episodes", async (req, reply) => {
  const ext = getExtension(req.params.id);
  if (!ext) return reply.status(404).send({ error: "Extension not found" });
  try {
    const episodes = await ext.findEpisodes(req.query.showId || "");
    reply.send(episodes);
  } catch (e) {
    reply.status(500).send({ error: e.message });
  }
});

// Get stream for a specific episode + server
// Called by player.js when the Play button is hit
fastify.post("/api/ext/:id/server", async (req, reply) => {
  const ext = getExtension(req.params.id);
  if (!ext) return reply.status(404).send({ error: "Extension not found" });
  try {
    const { episode, server } = req.body;
    if (!episode) return reply.status(400).send({ error: "episode required" });
    const result = await ext.findEpisodeServer(episode, server || "Server 1");
    reply.send(result);
  } catch (e) {
    console.error(`[ext/${req.params.id}] findEpisodeServer error:`, e.message);
    reply.status(500).send({ error: e.message });
  }
});

fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  const tmdbOk = !!process.env.TMDB_API_KEY;
  console.log(`[anime-stream] Running → http://localhost:${PORT}`);
  console.log(`[anime-stream] TMDB key: ${tmdbOk ? "✓ loaded" : "✗ MISSING — add TMDB_API_KEY to .env"}`);
  loadExtensions();
});
