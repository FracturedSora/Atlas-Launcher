// ══════════════════════════════════════════════════════════════════════════════
// Kaa Extension (kaa.lt / kaa.to)
// ══════════════════════════════════════════════════════════════════════════════
const BASE_URL = "https://kaa.lt";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0";

const extension = {
  id: "kaa",
  name: "Kaa",
  url: BASE_URL,
  logo: `${BASE_URL}/favicon.ico`,
  supportsDub: true,
  episodeServers: ["VidStreaming", "CatStream"],

  getSettings() {
    return {
      episodeServers: this.episodeServers,
      supportsDub: this.supportsDub,
    };
  },

  async search(query, dub = false) {
    // Handle either an object (from advanced wrappers) or a direct string
    const q = typeof query === "string" ? query : (query.query || "");

    const res = await fetch(`${BASE_URL}/api/fsearch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
      },
      body: JSON.stringify({
        query: q,
        page: 1,
      }),
    });

    const data = await res.json();

    if (!data.result || data.result.length === 0) {
      return [];
    }

    return data.result.map((item) => ({
      // Use query string formatting ?dub= for consistency with AnimeKai/AniCrush
      id: `${item.slug}?dub=${dub}`,
      title: item.title_en || item.title,
      url: `https://kaa.to${item.watch_uri}`,
      subOrDub: dub ? "dub" : "sub",
    }));
  },

  async findEpisodes(id) {
    const slug = id.split("?dub")[0];
    const isDub = id.split("?dub=")[1] === "true";

    // Fetch available languages for the show
    const langRes = await fetch(`${BASE_URL}/api/show/${slug}/language`, { headers: { "User-Agent": UA } });
    const langJson = await langRes.json();
    const langData = langJson.result || [];

    // Determine language preference
    let lang;
    if (isDub) {
      // Figure out what sub would have picked
      const subLang = langData.includes("zh-CN")
        ? "zh-CN"
        : langData.includes("ja-JP")
          ? "ja-JP"
          : langData[0];

      if (subLang === "ja-JP") {
        // If sub is ja-JP, then prefer en-US for dub if possible
        lang = langData.includes("en-US") ? "en-US" : langData[0];
      } else {
        // Otherwise, prefer ja-JP for dub
        lang = langData.includes("ja-JP") ? "ja-JP" : langData[0];
      }
    } else {
      // Sub logic: prefer zh-CN > ja-JP > first available
      lang = langData.includes("zh-CN")
        ? "zh-CN"
        : langData.includes("ja-JP")
          ? "ja-JP"
          : langData[0];
    }

    const epsUrl = `${BASE_URL}/api/show/${slug}/episodes?ep=1&lang=${lang}`;

    // Fetch first page
    const firstRes = await fetch(`${epsUrl}&page=1`, { headers: { "User-Agent": UA } });
    const firstData = await firstRes.json();

    // Determine all pages to fetch
    const pages = firstData.pages?.map((p) => p.number) || [1];

    // Fetch all other pages in parallel
    const otherPagePromises = pages
      .filter((p) => p !== 1)
      .map((page) => fetch(`${epsUrl}&page=${page}`, { headers: { "User-Agent": UA } }).then((r) => r.json()));

    const otherPageData = await Promise.all(otherPagePromises);

    // Combine all results into one array
    const allResults = [firstData, ...otherPageData]
      .flatMap((pageData) => pageData.result)
      .filter((ep) => Number.isInteger(ep.episode_number)); // Skip non-integer episodes

    const episodes = allResults.map((ep) => ({
      id: ep.slug,
      title: ep.title || `Episode ${ep.episode_string}`,
      number: ep.episode_number,
      url: `${BASE_URL}/api/show/${slug}/episode/ep-${ep.episode_string}-${ep.slug}`,
    }));

    // Ensure episodes are sorted correctly
    return episodes.sort((a, b) => a.number - b.number);
  },

  async findEpisodeServer(episode, _server = "VidStreaming") {
    const res = await fetch(episode.url, { headers: { "User-Agent": UA } });
    const data = await res.json();

    const server = data.servers.find((s) =>
      s.name.toLowerCase().trim() === _server.toLowerCase().trim()
    );

    if (!server) {
      console.warn("Available servers:", data.servers.map((s) => s.name));
      throw new Error(`ERROR: server ${_server} not found`);
    }

    let videoUrl = server.src.replace("vast", "player");
    const playerRes = await fetch(videoUrl, { headers: { "User-Agent": UA } });
    const html = await playerRes.text();

    const astroMatch = html.match(/<astro-island[^>]+props="([^"]+)"[^>]*>/);
    if (!astroMatch) throw new Error("Astro-island props not found in CatStream player");

    const propsStr = astroMatch[1].replace(/&quot;/g, '"');
    const props = JSON.parse(propsStr);

    if (props.manifest && props.manifest[1]) {
      let manifestUrl = props.manifest[1];
      if (manifestUrl.startsWith("//")) {
        manifestUrl = "https:" + manifestUrl;
      } else if (!manifestUrl.startsWith("http")) {
        manifestUrl = "https://" + manifestUrl;
      }
      videoUrl = manifestUrl;
    } else {
      throw new Error("Manifest URL not found in player data");
    }

    const subtitles = (props.subtitles && props.subtitles[1]) ? props.subtitles[1].map((sub) => {
      const urlRaw = sub[1].src[1];
      const urlFixed = urlRaw.replace("https:///", "https://");
      const languageCode = sub[1].language[1];
      const languageName = sub[1].name[1];

      return {
        label: languageName || "Unknown",
        url: urlFixed,
        default: languageCode === "en",
      };
    }) : [];

    return {
      server: _server,
      headers: {
        "Origin": "https://krussdomi.com",
        "Referer": server.src,
        "User-Agent": UA,
      },
      videoSources: [
        {
          url: videoUrl,
          quality: "Auto",
          type: "m3u8",
        },
      ],
      subtitleTracks: subtitles,
    };
  },
};

module.exports = extension;
