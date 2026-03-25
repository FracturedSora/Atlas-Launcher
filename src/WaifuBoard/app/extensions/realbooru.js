class Realbooru {
  constructor() {
    this.baseUrl = "https://realbooru.com";
    this.name = "RealBooru";
    this.type = "nsfw";
    this.logo = "https://realbooru.com/favicon.png";
  }

  async _fetch(targetUrl, signal) {
    const proxyUrl = `/proxy?url=${encodeURIComponent(targetUrl)}`;
    const response = await fetch(proxyUrl, { signal });
    if (!response.ok) throw new Error(`Proxy error: ${response.status}`);
    return await response.text();
  }

  async search(query = "", page = 1, perPage = 42) {
    const offset = (page - 1) * perPage;
    const tags = encodeURIComponent(query || "all");
    const url = `${this.baseUrl}/index.php?page=post&s=list&tags=${tags}&pid=${offset}`;

    try {
      const html = await this._fetch(url);
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const results = [];

      doc.querySelectorAll("div.col.thumb").forEach((el) => {
        const id = el.getAttribute("id")?.replace("s", "");
        const img = el.querySelector("img");
        let thumb = img?.getAttribute("src");

        if (thumb && thumb.startsWith("//")) thumb = `https:${thumb}`;

        const isVideo =
          thumb?.includes("video-preview.png") || thumb?.includes(".mp4");
        const isGif = thumb?.toLowerCase().includes(".gif");
        const tags =
          img
            ?.getAttribute("title")
            ?.split(",")
            .map((t) => t.trim())
            .filter(Boolean) || [];

        if (id && thumb) {
          results.push({ id, thumb, tags, isVideo, isGif });
        }
      });

      return { results, hasNext: results.length >= perPage };
    } catch (err) {
      return { results: [] };
    }
  }

  async getPostDetails(id) {
    const cleanId = id.toString().replace(/\D/g, "");
    const targetUrl = `${this.baseUrl}/index.php?page=post&s=view&id=${cleanId}`;

    try {
      const html = await this._fetch(targetUrl);
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // 1. Extract Metadata
      const tags = [];
      doc.querySelectorAll('a[href*="tags="]').forEach((a) => {
        const text = a.textContent.trim();
        if (
          text.length <= 1 ||
          /^(Next|Prev|back|Add|Edit|Unapprove)$/i.test(text)
        )
          return;
        const parentLi = a.closest("li");
        let type = "general";
        if (parentLi?.className) {
          const match = parentLi.className.match(/tag-type-([a-z]+)/);
          if (match) type = match[1];
        }
        if (!tags.find((t) => t.name === text))
          tags.push({ name: text.replace(/\s+/g, "_"), type });
      });

      // 2. Media Extraction - FIX: Use getAttribute to get raw source
      const videoSource = doc.querySelector("video source");
      const videoTag = doc.querySelector("video");
      const imageTag = doc.querySelector("#image");

      // Priority: <source> inside video -> <video src> -> <img> src
      let rawSrc =
        videoSource?.getAttribute("src") ||
        videoTag?.getAttribute("src") ||
        imageTag?.getAttribute("src") ||
        "";

      // 3. Protocol & Proxy Correction
      if (rawSrc.startsWith("//")) {
        rawSrc = "https:" + rawSrc;
      } else if (rawSrc.startsWith("/") && !rawSrc.startsWith("//")) {
        rawSrc = this.baseUrl + rawSrc;
      }

      // Check if it's a video file
      const isVideo = rawSrc.toLowerCase().match(/\.(mp4|webm|mov)$/i) !== null;

      // Final URL must be proxied to work in the modal
      const fullImage = `/proxy?url=${encodeURIComponent(rawSrc)}`;

      return { tags, comments: [], fullImage, isVideo };
    } catch (err) {
      console.error("Realbooru details failed:", err);
      return { tags: [], comments: [], fullImage: "", isVideo: false };
    }
  }
}

window.Nexus.register(Realbooru);
