"use strict";

const BASE_URL = "https://anicrush.to";
const API = "https://api.anicrush.to/shared/v2";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0";

// ── Helpers ───────────────────────────────────────────────────────────────────
const normalize = (title) => {
    return (title || "").toLowerCase()
        .replace(/(season|cour|part)/g, "")
        .replace(/\d+(st|nd|rd|th)/g, (m) => m.replace(/st|nd|rd|th/, ""))
        .replace(/[^a-z0-9]+/g, "")
        .replace(/(?<!i)ii(?!i)/g, "2");
};

const normalizeTitle = (title) => {
    return (title || "").toLowerCase()
        .replace(/(season|cour|part|uncensored)/g, "")
        .replace(/\d+(st|nd|rd|th)/g, (m) => m.replace(/st|nd|rd|th/, ""))
        .replace(/[^a-z0-9]+/g, "");
};

const levenshteinSimilarity = (a, b) => {
    const lenA = a.length, lenB = b.length;
    const dp = Array.from({ length: lenA + 1 }, () => new Array(lenB + 1).fill(0));
    for (let i = 0; i <= lenA; i++) dp[i][0] = i;
    for (let j = 0; j <= lenB; j++) dp[0][j] = j;
    for (let i = 1; i <= lenA; i++) {
        for (let j = 1; j <= lenB; j++) {
            if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
            else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return 1 - dp[lenA][lenB] / Math.max(lenA, lenB);
};

// ── Provider Class ────────────────────────────────────────────────────────────
class Provider {
    async search(query) {
        const isAdvanced = typeof query === "object" && query.media;
        const searchTerm = isAdvanced ? query.query : query;
        const isDub = isAdvanced ? !!query.dub : false;

        const url = `${API}/movie/list?keyword=${encodeURIComponent(searchTerm)}&limit=48&page=1`;
        const res = await fetch(url, { headers: { "X-Site": "anicrush", "Referer": BASE_URL } }).then(r => r.json());
        const matches = res.result?.movies || [];

        // 1. Tiered Metadata Filtering (Your advanced logic)
        if (isAdvanced && matches.length) {
            const start = query.media.startDate;
            const targetNormJP = normalize(query.media.romajiTitle);
            const targetNorm = query.media.englishTitle ? normalize(query.media.englishTitle) : targetNormJP;

            const filtered = matches.filter(m => {
                const nEn = normalize(m.name_english || m.name);
                const nJp = normalize(m.name);
                const yearMatch = m.aired_from?.includes(start?.year);
                return (nEn === targetNorm || nJp === targetNormJP || levenshteinSimilarity(nEn, targetNorm) > 0.8) && yearMatch;
            });

            if (filtered.length) {
                return filtered.map(m => ({
                    id: `${m.id}/${isDub ? "dub" : "sub"}`,
                    title: m.name_english || m.name,
                    url: `${BASE_URL}/detail/${m.slug}.${m.id}`,
                    subOrDub: isDub ? "dub" : "sub"
                }));
            }
        }

        // 2. Fallback Search (Keyword matching)
        return matches
            .filter(m => normalizeTitle(m.name_english || m.name).includes(normalizeTitle(searchTerm)))
            .map(m => ({
                id: `${m.id}/${isDub ? "dub" : "sub"}`,
                title: m.name_english || m.name,
                url: `${BASE_URL}/detail/${m.slug}.${m.id}`,
                subOrDub: isDub ? "dub" : "sub"
            }));
    }

    async findEpisodes(Id) {
        // 1. Safe Split: Handles "6wbOWi/sub" or just "6wbOWi"
        const parts = Id.split("/");
        const id = parts[0];
        const subOrDub = parts[1] || "sub"; // Default to sub if missing

        try {
            const url = `${API}/episode/list?_movieId=${id}`;
            const res = await fetch(url, {
                headers: {
                    "X-Site": "anicrush",
                    "Referer": BASE_URL,
                    "User-Agent": UA
                }
            }).then(r => r.json());

            const result = res.result || {};

            // 2. Robust Selection: Try requested type, then try sub, then try any key found
            let group = result[subOrDub];

            if (!group || !group.length) {
                group = result["sub"] || result["dub"] || Object.values(result)[0] || [];
            }

            if (!Array.isArray(group)) return [];

            // 3. Map to the Bridge ID (important for the sources route!)
            return group.map(ep => ({
                id: `${id}/${subOrDub}/${ep.number}`,
                number: ep.number,
                title: ep.name_english || `Episode ${ep.number}`,
            })).sort((a, b) => a.number - b.number);

        } catch (err) {
            console.error(`[AniCrush] Episode fetch failed for ${id}:`, err.message);
            return [];
        }
    }

    async findEpisodeServer(episode, _server) {
        const [id, subOrDub] = episode.id.split("/");
        const epNum = episode.number;
        const serverMap = { "Southcloud-1": 4, "Southcloud-2": 1, "Southcloud-3": 6 };
        const sv = serverMap[_server] ?? 4;

        const url = `${API}/episode/sources?_movieId=${id}&ep=${epNum}&sv=${sv}&sc=${subOrDub}`;

        try {
            const res = await fetch(url, { headers: { "X-Site": "anicrush", "Referer": BASE_URL } }).then(r => r.json());
            if (!res.result?.link) throw new Error("No link found");

            let decryptData = null;
            try {
                decryptData = await extractMegaCloud(res.result.link);
            } catch (err) {
                const fb = await fetch(`https://ac-api.ofchaos.com/api/anime/embed/convert/v2?embedUrl=${encodeURIComponent(res.result.link)}`);
                decryptData = await fb.json();
            }

            return {
                server: _server,
                container: subOrDub,
                metadata: { intro: decryptData.intro, outro: decryptData.outro },
                streams: (decryptData.sources || []).map(s => ({
                    url: s.file,
                    type: s.type === "hls" ? "hls" : "mp4",
                    quality: "auto"
                })),
                subtitles: (decryptData.tracks || [])
                    .filter(t => t.kind === "captions")
                    .map(t => ({
                        label: t.label || "Unknown",
                        file: t.file,
                        default: !!t.default
                    }))
            };
        } catch (err) {
            return { error: err.message };
        }
    }

    async resolveUrl(url) {
        const clean = url.split("?")[0].replace(/\/$/, "");
        const parts = clean.split("/");
        if (clean.includes("/watch/")) {
            const epNum = parseInt(parts.pop());
            const movieId = parts.pop().split(".").pop();
            return await this.findEpisodeServer({ id: `${movieId}/sub`, number: epNum });
        }
        if (clean.includes("/detail/")) {
            const movieId = url.split(".").pop();
            return await this.findEpisodes(`${movieId}/sub`);
        }
    }
}

// ── MegaCloud Decrypter ───────────────────────────────────────────────────────
async function extractMegaCloud(embedUrl) {
    const url = new URL(embedUrl);
    const baseDomain = `${url.protocol}//${url.host}/`;
    const headers = {
        "X-Requested-With": "XMLHttpRequest",
        "Referer": baseDomain,
        "User-Agent": UA
    };

    const html = await fetch(embedUrl, { headers }).then(r => r.text());
    const fileId = html.match(/<title>\s*File\s+#([a-zA-Z0-9]+)\s*-/i)?.[1];
    if (!fileId) throw new Error("file_id not found");

    let nonce = null;
    const match48 = html.match(/\b[a-zA-Z0-9]{48}\b/);
    if (match48) nonce = match48[0];
    else {
        const match3x16 = [...html.matchAll(/["']([A-Za-z0-9]{16})["']/g)];
        if (match3x16.length >= 3) nonce = match3x16[0][1] + match3x16[1][1] + match3x16[2][1];
    }

    const res = await fetch(`${baseDomain}embed-2/v3/e-1/getSources?id=${fileId}&_k=${nonce}`, { headers }).then(r => r.json());
    return { sources: res.sources, tracks: res.tracks || [], intro: res.intro, outro: res.outro };
}

module.exports = Provider;
