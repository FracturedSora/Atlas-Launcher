// ══════════════════════════════════════════════════════════════════════════════
// AnimeKai Extension (animekai.to)
// ══════════════════════════════════════════════════════════════════════════════
const { parse } = require("node-html-parser");
const API = "https://animekai.to";
const UA  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const BASE_HEADERS = {
  "User-Agent": UA,
  "DNT": "1",
  "Cookie": "__ddg1_=;__ddg2_=;",
};

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function GET(url, extra = {}) {
  const res = await fetch(url, { headers: { ...BASE_HEADERS, ...extra } });
  if (!res.ok) throw new Error(`HTTP ${res.status} → ${url}`);
  return res;
}
const getText = (url, h) => GET(url, h).then(r => r.text());
const getJson = (url, h) => GET(url, h).then(r => r.json());

// Encode token via enc-kai service
async function encKai(text) {
  const r = await getJson(`https://enc-dec.app/api/enc-kai?text=${encodeURIComponent(text)}`);
  if (!r?.result) throw new Error("encKai returned no result");
  return r.result;
}

// Clean escaped HTML from JSON responses
function cleanHtml(s) {
  if (!s) return "";
  return s
    .replace(/\\"/g, '"').replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\").replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t").replace(/\\r/g, "\r");
}

// Normalise search query
function normalise(q) {
  return q
    .replace(/\b(\d+)(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .replace(/(\d+)\s*Season/i, "$1")
    .replace(/Season\s*(\d+)/i, "$1")
    .trim();
}

// ── Decrypt helpers ───────────────────────────────────────────────────────────
async function decryptKai(encResult) {
  const r = await fetch("https://enc-dec.app/api/dec-kai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: encResult }),
  }).then(r => r.json());
  return r?.result?.url ?? null;
}

async function decryptMega(encResult) {
  const r = await fetch("https://enc-dec.app/api/dec-mega", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: encResult, agent: UA }),
  }).then(r => r.json());
  if (r?.status !== 200) throw new Error("dec-mega failed");
  return r.result;
}

// ── Extension Object ──────────────────────────────────────────────────────────
const extension = {
  id: "animekai",
  name: "AnimeKai",
  url: API,
  logo: `${API}/favicon.ico`,
  supportsDub: true,
  episodeServers: ["Server 1", "Server 2"],

  async search(query, dub = false) {
    const q = normalise(query);
    const html = await getText(`${API}/browser?keyword=${encodeURIComponent(q)}`);
    const root = parse(html);
    const out = [];
    for (const el of root.querySelectorAll("div.aitem-wrapper > div.aitem")) {
      const href = el.querySelector("a.poster")?.getAttribute("href") ?? "";
      const title = el.querySelector("a.title")?.getAttribute("title") ?? "";
      if (!href || !title) continue;
      const id = href.replace(/^\//, "");
      const hasSub = !!el.querySelector("span.sub");
      const hasDub = !!el.querySelector("span.dub");
      out.push({
        id: `${id}?dub=${dub}`,
        title,
        url: `${API}/${id}`,
        subOrDub: hasSub && hasDub ? "both" : hasSub ? "sub" : "dub",
      });
    }
    return out;
  },

  async findEpisodes(id) {
    const cleanId = id.split("?dub")[0];
    const dub = id.split("?dub=")[1] ?? "false";
    const html = await getText(`${API}/${cleanId}`);
    const aniIdM = html.match(/<div[^>]+class="rate-box"[^>]+data-id="([^"]+)"/);
    if (!aniIdM) throw new Error("Anime ID not found");
    const aniId = aniIdM[1];
    const token = await encKai(aniId);
    const ajax = await getJson(`${API}/ajax/episodes/list?ani_id=${aniId}&_=${token}`);
    const root = parse(ajax.result ?? "");
    const links = root.querySelectorAll("ul.range > li > a");
    const episodes = await Promise.all(links.map(async a => {
      const num = parseInt(a.getAttribute("num") ?? "0", 10);
      const tok = a.getAttribute("token") ?? "";
      const title = (a.querySelector("span")?.text ?? "").replace(/\s+/g, " ").trim();
      const enc = await encKai(tok);
      return {
        id: tok,
        number: num,
        title: title || `Episode ${num}`,
        url: `${API}/ajax/links/list?token=${tok}&_=${enc}?dub=${dub}`,
      };
    }));
    return episodes.sort((a, b) => a.number - b.number);
  },

  async findEpisodeServer(episode, server = "Server 1") {
    const epUrl = episode.url.split("?dub")[0];
    const dubRequested = episode.url.split("?dub=")[1] === "true";
    const raw = await getText(epUrl);
    const cleaned = cleanHtml(raw);
    const grab = (langId) => {
      const re = new RegExp(`<div[^>]+class="server-items lang-group"[^>]+data-id="${langId}"[^>]*>([\\s\\S]*?)</div>`);
      const m = re.exec(cleaned);
      return m ? m[1] : "";
    };
    const subHtml = grab("sub");
    const softsubHtml = grab("softsub");
    const dubHtml = grab("dub");
    const serverRe = server === "Server 1"
      ? /<span[^>]+class="server"[^>]+data-lid="([^"]+)"[^>]*>\s*Server 1\s*<\/span>/
      : /<span[^>]+class="server"[^>]+data-lid="([^"]+)"[^>]*>\s*Server 2\s*<\/span>/;
    const ids = {
      Dub: serverRe.exec(dubHtml)?.[1] ?? null,
      Softsub: serverRe.exec(softsubHtml)?.[1] ?? null,
      Sub: serverRe.exec(subHtml)?.[1] ?? null,
    };
    const valid = Object.entries(ids).filter(([, v]) => v);
    if (!valid.length) throw new Error("No servers available");
    const viewUrls = await Promise.all(valid.map(async ([name, lid]) => {
      const enc = await encKai(lid);
      return { name, url: `${API}/ajax/links/view?id=${lid}&_=${enc}` };
    }));
    const embedResponses = await Promise.all(viewUrls.map(async ({ name, url }) => {
      try {
        const j = await getJson(url);
        return { name, result: j.result };
      } catch (_) { return { name, result: null }; }
    }));
    const embedUrls = {};
    await Promise.all(embedResponses.filter(x => x.result).map(async ({ name, result }) => {
      const url = await decryptKai(result);
      if (url) embedUrls[name] = url;
    }));
    const embedUrl = dubRequested ? embedUrls.Dub : (embedUrls.Sub ?? embedUrls.Softsub);
    if (!embedUrl) throw new Error("Source selection failed");

    // ── Media Fetch ──
    const mediaUrl = embedUrl.replace("/e/", "/media/");
    const mediaRes = await fetch(mediaUrl, { headers: { "Referer": `${API}/`, "User-Agent": UA } });
    const mediaJson = await mediaRes.json();
    const final = await decryptMega(mediaJson.result);
    const m3u8Url = final.sources[0].file;

    // ── TRULY FIXED PLAYLIST PARSING ──
    // 1. Fetch the playlist WITH headers so the CDN doesn't 403 us
    const playlistRes = await fetch(m3u8Url, {
      headers: { "Referer": `${API}/`, "User-Agent": UA }
    });

    if (!playlistRes.ok) throw new Error(`Failed to fetch master playlist: HTTP ${playlistRes.status}`);

    const playlist = await playlistRes.text();
    // Use the final URL in case the CDN redirected the initial request
    const finalM3u8Url = playlistRes.url || m3u8Url;

    const videoSources = [];
    const variantRe = /#EXT-X-STREAM-INF:[^\n]*RESOLUTION=(\d+x\d+)[^\n]*\n(\S+)/g;
    let m;

    while ((m = variantRe.exec(playlist)) !== null) {
      const res = m[1];
      const rel = m[2].trim();

      try {
        // 2. Use native URL parsing. This effortlessly handles query strings,
        // absolute URLs, and crazy relative paths.
        const absUrl = new URL(rel, finalM3u8Url).href;

        videoSources.push({
          quality: res.split("x")[1] + "p",
          url: absUrl,
          type: "m3u8",
        });
      } catch (e) {
        // Fallback for extreme edge cases
        videoSources.push({ quality: res.split("x")[1] + "p", url: rel, type: "m3u8" });
      }
    }

    // If it's a direct stream instead of a master playlist, return the base URL
    if (!videoSources.length) {
      videoSources.push({ quality: "Auto", url: finalM3u8Url, type: "m3u8" });
    }

    videoSources.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));

    return {
      server,
      headers: { "Referer": `${API}/`, "User-Agent": UA },
      videoSources,
      subtitleTracks: (final.tracks ?? []).filter(t => t.kind !== "thumbnails").map(t => ({
        label: t.label, url: t.file, default: !!t.default
      })),
      hasDub: !!ids.Dub,
      skipTimes: null
    };
  },
};

module.exports = extension;
