// ══════════════════════════════════════════════════════════════════════════════
// AnimeKai Extension (anikai.to)
// ══════════════════════════════════════════════════════════════════════════════
const { parse } = require("node-html-parser");
const API = "https://anikai.to"; // Updated to anikai.to
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
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Encode token via enc-kai service
async function encKai(text) {
  const r = await getJson(`https://enc-dec.app/api/enc-kai?text=${encodeURIComponent(text)}`);
  if (!r?.result) throw new Error("encKai returned no result");
  return r.result;
}

// Clean escaped HTML and Unicode from JSON responses
function cleanHtml(s) {
  if (!s) return "";
  return s
    .replace(/\\"/g, '"').replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\").replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t").replace(/\\r/g, "\r")
    .replace(/\\u([\dA-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
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
    const links = Array.from(root.querySelectorAll("ul.range > li > a"));

    // Batch processing to avoid overloading the enc-dec service
    const episodes = [];
    const batchSize = 50;
    for (let i = 0; i < links.length; i += batchSize) {
      const batch = links.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(async a => {
        const num = parseInt(a.getAttribute("num") ?? "0", 10);
        const tok = a.getAttribute("token") ?? "";
        const title = (a.querySelector("span")?.text ?? "").replace(/\s+/g, " ").trim();
        try {
          const enc = await encKai(tok);
          return {
            id: tok,
            number: num,
            title: title || `Episode ${num}`,
            url: `${API}/ajax/links/list?token=${tok}&_=${enc}?dub=${dub}`,
          };
        } catch (e) {
          return null; // Skip if encoding fails
        }
      }));

      episodes.push(...batchResults.filter(Boolean));
      if (i + batchSize < links.length) await sleep(500);
    }

    return episodes.sort((a, b) => a.number - b.number);
  },

  async findEpisodeServer(episode, server = "Server 1") {
    // Correctly format URLs avoiding accidental unicode conversion issues
    const epUrl = episode.url.replace('\u0026', '&').split('?dub')[0];
    const dubRequested = episode.url.split('?dub=')[1] === "true";

    // The endpoint returns JSON containing the HTML string
    const resJson = await getJson(epUrl);
    if ((resJson.status !== 'ok' && resJson.status !== 200) || !resJson.result) {
        throw new Error(`Failed to fetch episode page: ${resJson.status}`);
    }
    const cleaned = cleanHtml(resJson.result);

    const grab = (langId) => {
      const re = new RegExp(`<div class="server-items lang-group" data-id="${langId}"[^>]*>([\\s\\S]*?)<\\/div>`);
      const m = re.exec(cleaned);
      return m ? m[1].trim() : "";
    };

    const subHtml = grab("sub");
    const softsubHtml = grab("softsub");
    const dubHtml = grab("dub");

    const serverRe = server === "Server 1"
      ? /<span class="server"[^>]*data-lid="([^"]+)"[^>]*>Server 1<\/span>/
      : /<span class="server"[^>]*data-lid="([^"]+)"[^>]*>Server 2<\/span>/;

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

    if (!final?.sources || final.sources.length === 0) throw new Error("No video sources found");
    const m3u8Url = final.sources[0].file;

    // ── TRULY FIXED PLAYLIST PARSING ──
    const playlistRes = await fetch(m3u8Url, {
      headers: { "Referer": `${API}/`, "User-Agent": UA }
    });

    if (!playlistRes.ok) throw new Error(`Failed to fetch master playlist: HTTP ${playlistRes.status}`);

    const playlist = await playlistRes.text();
    const finalM3u8Url = playlistRes.url || m3u8Url;

    const videoSources = [];
    // Updated Regex to match exact functionality from your TypeScript snippet
    const variantRe = /#EXT-X-STREAM-INF:BANDWIDTH=\d+,RESOLUTION=(\d+x\d+)\s*(.*)/g;
    let m;

    while ((m = variantRe.exec(playlist)) !== null) {
      const res = m[1];
      const rel = m[2].trim();

      let url = "";
      if (rel.includes("list")) {
          url = `${finalM3u8Url.split(',')[0]}/${rel}`;
      } else {
          url = `${finalM3u8Url.split('/list')[0]}/${rel}`;
      }

      videoSources.push({
        quality: res.split("x")[1] + "p",
        url: url,
        type: "m3u8",
        subtitles: [] // Subs are integrated into the source via Mega provider
      });
    }

    if (!videoSources.length) {
      videoSources.push({ quality: "Auto", url: finalM3u8Url, type: "m3u8", subtitles: [] });
    }

    videoSources.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));

    return {
      server,
      headers: {
          "Access-Control-Allow-Origin": "*",
          "Referer": `${API}/`,
          "User-Agent": UA
      },
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
