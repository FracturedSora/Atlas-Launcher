// 1. ABSOLUTELY FIRST: POLYFILLS
const { File } = require("node:buffer");
global.File = File;

const fastify = require("fastify")({ logger: false }); // logger:false prevents log spam crashing stdio
const path = require("path");
const fs = require("fs");
const cheerio = require("cheerio");
global.cheerio = cheerio;

// ─── Auth ─────────────────────────────────────────────────────────────────────
const AUTH_HEADER_NAME = "x-secret-key";
const AUTH_HEADER_VALUE =
  "6007278395b8b11a424fe69eca218e70ef0c6e79ada713beff1a1bbf6f20863bf95a0b9b2a467a7f7fb728a175c1861f367605e421186095cda92542";

// fastify.addHook("preHandler", async (request, reply) => {
//   const secretKey = request.headers[AUTH_HEADER_NAME];
//   if (secretKey !== AUTH_HEADER_VALUE) {
//     return reply.redirect("https://www.youtube.com");
//   }
// });

// ─── CORS ─────────────────────────────────────────────────────────────────────
fastify.register(require("@fastify/cors"), {
  origin: true,
  allowedHeaders: ["x-secret-key", "content-type"],
});

// ─── Atomic DB ────────────────────────────────────────────────────────────────

const dbPath = path.join(__dirname, "waifumanga.db");

const db = {
  data: { metadata: {}, series: {}, home: null, homeLastFetch: 0 },

  load() {
    if (fs.existsSync(dbPath)) {
      try {
        const content = fs.readFileSync(dbPath, "utf8");
        const parsed = JSON.parse(content);
        this.data = Object.assign(
          { metadata: {}, series: {}, home: null, homeLastFetch: 0 },
          parsed,
        );
      } catch (e) {
        console.error("DB corrupted — resetting:", e.message);
      }
    }
    this.save();
  },

  save() {
    try {
      const tempPath = dbPath + ".tmp";
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), "utf8");
      fs.renameSync(tempPath, dbPath);
    } catch (e) {
      console.error("DB save failed:", e.message);
    }
  },
};

db.load();

// ─── Rate-limited AniList queue ───────────────────────────────────────────────
// Semaphore-style queue: one error NEVER kills the queue for subsequent callers.
// Each caller gets their own promise resolved/rejected independently.

let _anilistBusy = false;
const _anilistWaiters = [];

function anilistThrottle(fn) {
  return new Promise((resolve, reject) => {
    _anilistWaiters.push({ fn, resolve, reject });
    _drainAnilist();
  });
}

async function _drainAnilist() {
  if (_anilistBusy || _anilistWaiters.length === 0) return;
  _anilistBusy = true;

  const { fn, resolve, reject } = _anilistWaiters.shift();

  try {
    resolve(await fn());
  } catch (e) {
    reject(e);
  } finally {
    await new Promise((r) => setTimeout(r, 700)); // 700ms between all AniList requests
    _anilistBusy = false;
    _drainAnilist(); // drain next
  }
}

async function anilistFetch(variables, query) {
  return anilistThrottle(async () => {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
    return res.json();
  });
}

// ─── AniList metadata (cache-first, rate-limited) ─────────────────────────────
const METADATA_QUERY = `
  query ($search: String) {
    Media(search: $search, type: MANGA) {
      id
      title { romaji english }
      coverImage { large }
      description
      isAdult
    }
  }`;

async function fetchAnilistMetadata(title) {
  if (db.data.metadata[title]) return db.data.metadata[title];

  try {
    const json = await anilistFetch({ search: title }, METADATA_QUERY);
    const media = json.data?.Media;
    if (media) {
      db.data.metadata[title] = media;
      db.save();
    }
    return media || null;
  } catch (e) {
    console.error(`AniList metadata failed for "${title}":`, e.message);
    return null;
  }
}

// ─── Full series query ─────────────────────────────────────────────────────────
const SERIES_QUERY = `
  query($id: Int, $search: String) {
    Media(id: $id, search: $search, type: MANGA) {
      id
      title { english romaji native }
      synonyms
      description(asHtml: false)
      status
      startDate { year month day }
      endDate { year month day }
      chapters volumes countryOfOrigin isAdult format
      genres
      tags { name category rank isMediaSpoiler }
      averageScore meanScore popularity favourites
      coverImage { extraLarge large color }
      bannerImage
      staff(sort: RELEVANCE, perPage: 10) {
        edges { role node { id name { full } image { medium } siteUrl } }
      }
      characters(sort: ROLE, perPage: 12) {
        edges { role node { id name { full } image { medium } } }
      }
      relations {
        edges {
          relationType
          node { id title { english romaji } type format coverImage { medium } status }
        }
      }
    }
  }`;

// ─── Fastify registrations ─────────────────────────────────────────────────────
fastify.register(require("@fastify/static"), {
  root: path.join(__dirname, "public"),
  prefix: "/",
});

// ─── Cloudscraper fetch (CF bypass for extensions) ────────────────────────────
const cloudscraper = require("cloudscraper");

// Capture node-fetch directly — never touches globalThis.fetch so no recursion
const _nativeFetch = (...args) =>
  import("node-fetch").then(({ default: f }) => f(...args));

const CF_HOSTS = ["mangafire.to"];

global.fetch = async (url, options = {}) => {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  const needsCF = CF_HOSTS.some((h) => host.includes(h));

  if (!needsCF) {
    return _nativeFetch(url, options);
  }

  // Route through cloudscraper
  const method = (options.method || "GET").toUpperCase();
  const csOptions = {
    method,
    url,
    headers: options.headers || {},
    encoding: null, // get raw buffer
  };

  if (options.body) csOptions.body = options.body;

  const rawBuffer = await new Promise((resolve, reject) => {
    cloudscraper(csOptions, (err, response, body) => {
      if (err)
        return reject(
          new Error(
            err.errorType === 1
              ? "CF challenge failed"
              : err.message || String(err),
          ),
        );
      resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body,
      });
    });
  });

  // Wrap in a fetch-compatible Response shape
  const bodyBuf = Buffer.isBuffer(rawBuffer.body)
    ? rawBuffer.body
    : Buffer.from(rawBuffer.body || "");
  const contentType = rawBuffer.headers["content-type"] || "";

  return {
    ok: rawBuffer.statusCode >= 200 && rawBuffer.statusCode < 300,
    status: rawBuffer.statusCode,
    headers: { get: (k) => rawBuffer.headers[k.toLowerCase()] || null },
    text: async () => bodyBuf.toString("utf-8"),
    json: async () => JSON.parse(bodyBuf.toString("utf-8")),
    arrayBuffer: async () =>
      bodyBuf.buffer.slice(
        bodyBuf.byteOffset,
        bodyBuf.byteOffset + bodyBuf.byteLength,
      ),
  };
};

// ─── Extension loader ──────────────────────────────────────────────────────────

global.window = {};
global.window.Nexus = {
  extensions: [],
  register(ExtensionClass) {
    try {
      const ext = new ExtensionClass();
      this.extensions.push(ext);
      console.log(
        `Extension loaded: ${ext.name} [${ext.type || "sfw"}] [${ext.format || "manga"}]`,
      );
    } catch (e) {
      console.error("Extension register() failed:", e.message);
    }
  },
};

const extensionsDir = path.join(__dirname, "app", "extensions");
if (!fs.existsSync(extensionsDir))
  fs.mkdirSync(extensionsDir, { recursive: true });

fs.readdirSync(extensionsDir)
  .filter((f) => f.endsWith(".js"))
  .forEach((file) => {
    const code = fs.readFileSync(path.join(extensionsDir, file), "utf8");
    try {
      const scoped = new Function(
        "fetch",
        "window",
        "cheerio",
        "console",
        code + `\n//# sourceURL=${file}`,
      );
      scoped(global.fetch, global.window, global.cheerio, console);
    } catch (e) {
      console.error(`Failed to load ${file}:`, e.message);
    }
  });

// ─── Routes ───────────────────────────────────────────────────────────────────

fastify.get("/", async (_req, reply) => reply.sendFile("index.html"));
fastify.get("/series/:id", async (_req, reply) =>
  reply.sendFile("series.html"),
);
fastify.get("/read", async (_req, reply) => reply.sendFile("reader.html"));
// Wildcard to catch /read/anything — pipes in path params cause issues, redirect to query style
fastify.get("/read/*", async (request, reply) => {
  const raw = request.params["*"];
  const qs = new URLSearchParams(request.query);
  qs.set("id", decodeURIComponent(raw));
  return reply.redirect("/read?" + qs.toString());
});

// ── GET /api/series/:id ────────────────────────────────────────────────────────
fastify.get("/api/series/:id", async (request, reply) => {
  const { id } = request.params;
  const isNumeric = /^\d+$/.test(id);
  if (!db.data.series) db.data.series = {};

  // 1. URL-key cache hit
  if (db.data.series[id]) {
    return reply.send({
      success: true,
      data: db.data.series[id],
      cached: true,
    });
  }

  // 2. Numeric ID scan through metadata cache
  if (isNumeric) {
    const numId = parseInt(id);
    const hit = Object.values(db.data.metadata).find(
      (m) => m.id === numId && m.genres && m.staff,
    );
    if (hit) {
      db.data.series[id] = hit;
      db.save();
      return reply.send({ success: true, data: hit, cached: true });
    }
  }

  // 3. Fetch from AniList via throttled queue
  const variables = isNumeric
    ? { id: parseInt(id) }
    : { search: decodeURIComponent(id.replace(/-/g, " ")) };

  try {
    const json = await anilistFetch(variables, SERIES_QUERY);
    const media = json.data?.Media;

    if (!media) {
      const rateLimited = json.errors?.some(
        (e) => e.status === 429 || String(e.message).includes("rate"),
      );
      return rateLimited
        ? reply
            .code(429)
            .send({ error: "AniList rate limited — try again shortly." })
        : reply.code(404).send({ error: "Series not found on AniList" });
    }

    db.data.series[id] = media;
    db.data.series[String(media.id)] = media;
    db.data.metadata[media.title.english || media.title.romaji] = media;
    db.save();

    return reply.send({ success: true, data: media });
  } catch (e) {
    console.error("Series fetch error:", e.message);
    return reply
      .code(500)
      .send({ error: "AniList fetch failed", detail: e.message });
  }
});

// ── GET /api/extensions ────────────────────────────────────────────────────────
// Optional ?format=manga|novel to filter by extension format
fastify.get("/api/extensions", async (request, reply) => {
  const contentType = (request.query.contentType || "sfw").toLowerCase();
  const format = (request.query.format || "").toLowerCase(); // "manga", "novel", or "" for all

  const exts = global.window.Nexus.extensions
    .filter((ext) => contentType === "nsfw" || ext.type !== "nsfw")
    .filter((ext) => {
      if (!format) return true;
      const extFormat = (ext.format || "manga").toLowerCase();
      return extFormat === format;
    })
    .map((ext) => ({
      name: ext.name,
      icon: ext.icon || ext.logo || "",
      type: ext.type || "sfw",
      format: ext.format || "manga",
    }));
  return reply.send({ success: true, data: exts });
});

// ── GET /api/series-ext ────────────────────────────────────────────────────────
// Fetches series metadata from an extension (for non-AniList sources like NovelBin)
// Returns data in the same shape renderSeries() expects
fastify.get("/api/series-ext", async (request, reply) => {
  const { id, source } = request.query;
  if (!id || !source)
    return reply.code(400).send({ error: "Missing id or source" });

  const ext = global.window.Nexus.extensions.find((e) => e.name === source);
  if (!ext)
    return reply.code(404).send({ error: `Source "${source}" not found` });

  if (typeof ext.getPostDetails !== "function") {
    return reply
      .code(404)
      .send({ error: `${source} has no getPostDetails method` });
  }

  try {
    const details = await ext.getPostDetails(id);

    // Normalise to the same shape renderSeries() reads from AniList
    const data = {
      // Identify as extension-sourced so client can skip AniList-only fields
      _source: source,
      _sourceId: id,

      // Title — match AniList shape
      title: {
        english: details.title || id,
        romaji: details.title || id,
        native: null,
      },
      synonyms: [],
      description: details.description || "",
      status: details.status || null,
      format: details.type === "novel" ? "NOVEL" : "MANGA",
      countryOfOrigin: null,
      isAdult: false,
      chapters: details.chapters?.length || null,
      volumes: null,
      startDate: null,
      endDate: null,
      averageScore: null,
      meanScore: null,
      popularity: null,
      favourites: null,
      genres: (details.tags || [])
        .filter((t) => t.type === "genre")
        .map((t) => t.name),
      tags: (details.tags || []).map((t) => ({
        name: t.name,
        category: t.type || "genre",
        rank: 80,
        isMediaSpoiler: false,
      })),

      // Cover image — match AniList shape
      coverImage: {
        extraLarge: details.thumb || null,
        large: details.thumb || null,
        color: null,
      },
      bannerImage: details.banner || details.thumb || null,

      // Staff from author field if present
      staff: details.author
        ? {
            edges: [
              {
                role: "Story",
                node: {
                  id: 0,
                  name: { full: details.author },
                  image: { medium: null },
                  siteUrl: null,
                },
              },
            ],
          }
        : { edges: [] },

      characters: { edges: [] },
      relations: { edges: [] },
    };

    return reply.send({ success: true, data });
  } catch (e) {
    console.error("[series-ext] error:", e.message);
    return reply
      .code(500)
      .send({ error: "Extension fetch failed", detail: e.message });
  }
});

// ── GET /api/chapters ──────────────────────────────────────────────────────────
fastify.get("/api/chapters", async (request, reply) => {
  const { source, q } = request.query;
  if (!source || !q)
    return reply.code(400).send({ error: "Missing source or q" });

  const ext = global.window.Nexus.extensions.find((e) => e.name === source);
  if (!ext) {
    return reply.code(404).send({
      error: `Source "${source}" not found`,
      available: global.window.Nexus.extensions.map((e) => e.name),
    });
  }

  try {
    console.log(`[chapters] ${source} <- "${q}"`);
    const searchResult = await ext.search(q, 1);
    const results = searchResult?.results || [];

    if (!results.length) {
      return reply.send({
        success: true,
        chapters: [],
        message: "No results on this source",
      });
    }

    const first = results[0];
    console.log(`[chapters] matched: "${first.title}" (${first.id})`);

    let chapters = [];
    if (typeof ext.getChapters === "function") {
      const r = await ext.getChapters(first.id);
      chapters = r?.chapters || [];
    } else if (typeof ext.getPostDetails === "function") {
      const r = await ext.getPostDetails(first.id);
      chapters = r?.chapters || [];
    }

    console.log(`[chapters] ${chapters.length} chapters`);
    return reply.send({
      success: true,
      chapters,
      mangaId: first.id,
      title: first.title,
    });
  } catch (e) {
    console.error(`[chapters] error:`, e.message);
    return reply
      .code(500)
      .send({ error: "Chapter fetch failed", detail: e.message });
  }
});

// ── GET /api/pages ────────────────────────────────────────────────────────────
// id and source are query params — avoids pipe character issues in path params
fastify.get("/api/pages", async (request, reply) => {
  const { id: chapterId, source } = request.query;

  if (!chapterId) return reply.code(400).send({ error: "Missing id param" });
  if (!source) return reply.code(400).send({ error: "Missing source param" });
  const ext = global.window.Nexus.extensions.find((e) => e.name === source);
  if (!ext)
    return reply.code(404).send({ error: `Source "${source}" not found` });

  try {
    const extFormat = (ext.format || "manga").toLowerCase();

    if (extFormat === "novel") {
      // Novel extension — use getChapterContent
      if (typeof ext.getChapterContent !== "function") {
        return reply
          .code(404)
          .send({ error: `${source} has no getChapterContent method` });
      }
      const content = await ext.getChapterContent(chapterId);
      return reply.send({
        success: true,
        type: "novel",
        content: content || "",
      });
    } else {
      // Manga extension — use getChapterPages
      if (typeof ext.getChapterPages !== "function") {
        return reply
          .code(404)
          .send({ error: `${source} has no getChapterPages method` });
      }
      const pages = await ext.getChapterPages(chapterId);
      if (!pages?.length)
        return reply
          .code(404)
          .send({ error: "No pages found for this chapter" });
      return reply.send({ success: true, type: "manga", pages });
    }
  } catch (e) {
    console.error("[pages] error:", e.message);
    return reply
      .code(500)
      .send({ error: "Page fetch failed", detail: e.message });
  }
});

// ── GET /api/search (SSE) ──────────────────────────────────────────────────────
// Streams results directly from extensions — no AniList enrichment, instant results.
fastify.get("/api/search", (request, reply) => {
  const { q, contentType } = request.query;
  const allowNsfw = contentType === "nsfw";

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const exts = global.window.Nexus.extensions.filter(
    (ext) => allowNsfw || ext.type !== "nsfw",
  );

  if (!exts.length) {
    reply.raw.write("event: end\ndata: {}\n\n");
    reply.raw.end();
    return;
  }

  let done = 0;

  function finish() {
    done++;
    if (done === exts.length && !reply.raw.writableEnded) {
      reply.raw.write("event: end\ndata: {}\n\n");
      reply.raw.end();
    }
  }

  exts.forEach((ext) => {
    ext
      .search(q, 1, contentType)
      .then((response) => {
        const items = (response?.results || []).map((item) => ({
          ...item,
          sourceName: ext.name,
        }));

        if (items.length > 0 && !reply.raw.writableEnded) {
          reply.raw.write(
            `data: ${JSON.stringify({ sourceName: ext.name, data: items })}\n\n`,
          );
        }
      })
      .catch((e) => {
        console.error(`[search] ${ext.name} error:`, e.message);
      })
      .finally(finish);
  });
});

// ── GET /api/home ──────────────────────────────────────────────────────────────
fastify.get("/api/home", async (_req, reply) => {
  const FIVE_HOURS = 5 * 60 * 60 * 1000;
  if (db.data.home && Date.now() - db.data.homeLastFetch < FIVE_HOURS) {
    return reply.send({ success: true, data: db.data.home });
  }

  const query = `
    query {
      trending:  Page(page: 1, perPage: 15) { media(type: MANGA, sort: TRENDING_DESC,   isAdult: false) { id title { romaji english } coverImage { extraLarge large } bannerImage description genres } }
      popular:   Page(page: 1, perPage: 15) { media(type: MANGA, sort: POPULARITY_DESC, isAdult: false) { id title { romaji english } coverImage { large } description genres } }
      favorites: Page(page: 1, perPage: 15) { media(type: MANGA, sort: FAVOURITES_DESC, isAdult: false) { id title { romaji english } coverImage { large } description genres } }
    }`;

  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const result = await res.json();
    if (result.data) {
      db.data.home = {
        trending: result.data.trending.media,
        popular: result.data.popular.media,
        favorites: result.data.favorites.media,
      };
      db.data.homeLastFetch = Date.now();
      db.save();
      return reply.send({ success: true, data: db.data.home });
    }
    return reply.send({ success: false, data: null });
  } catch (e) {
    console.error("Home fetch failed:", e.message);
    return reply.send({ success: false, data: null });
  }
});

// ── GET /api/proxy ─────────────────────────────────────────────────────────────
fastify.get("/api/proxy", async (request, reply) => {
  const { url, referer } = request.query;
  if (!url) return reply.code(400).send("No URL provided");
  try {
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
    if (referer) headers["Referer"] = referer;

    const r = await fetch(url, { headers });
    if (!r.ok) {
      console.error(`[proxy] ${r.status} for ${url}`);
      return reply.code(r.status).send(`Upstream returned ${r.status}`);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "image/jpeg";
    reply.header("Content-Type", ct);
    reply.header("Cache-Control", "public, max-age=86400");
    reply.header("Access-Control-Allow-Origin", "*");
    return reply.send(buf);
  } catch (e) {
    console.error("[proxy] error:", e.message);
    return reply.code(500).send("Proxy failed");
  }
});

// ── Debug (remove once chapters confirmed working) ─────────────────────────────
fastify.get("/api/debug/chapters", async (request, reply) => {
  const { source = "Comix", q = "blue box" } = request.query;
  const ext = global.window.Nexus.extensions.find((e) => e.name === source);
  if (!ext)
    return reply.send({
      error: "not found",
      available: global.window.Nexus.extensions.map((e) => e.name),
    });
  const log = [];
  try {
    log.push("searching...");
    const sr = await ext.search(q, 1);
    log.push(`search: ${sr?.results?.length} results`);
    if (!sr?.results?.length) return reply.send({ log, error: "no results" });
    const first = sr.results[0];
    log.push(`first: "${first.title}" id=${first.id}`);
    log.push("getChapters...");
    const cr = await ext.getChapters(first.id);
    log.push(`chapters: ${cr?.chapters?.length}`);
    return reply.send({
      log,
      count: cr?.chapters?.length,
      first: cr?.chapters?.[0],
      last: cr?.chapters?.at?.(-1),
    });
  } catch (e) {
    return reply.send({ log, error: e.message });
  }
});

// Proxy AniList account info from the launcher API
fastify.get("/api/anilist/me", async (req, reply) => {
  try {
    const res = await fetch("http://localhost:3000/api/v1/anilist/me");
    if (!res.ok) return reply.status(res.status).send({ error: "Not logged in" });
    const data = await res.json();
    return reply.send(data);
  } catch (e) {
    return reply.status(500).send({ error: e.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
fastify.listen({ port: 3001, host: "0.0.0.0" }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log("WaifuManga running → http://localhost:3001");
});
