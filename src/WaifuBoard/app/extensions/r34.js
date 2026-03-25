// Updated Rule34 class to use local proxy to bypass CORS
class Rule34 {
  constructor() {
    this.baseUrl = "https://rule34.xxx";
    this.type = "nsfw";
    this.logo = "https://rule34.xxx/apple-touch-icon.png";
  }

  // Helper to wrap URLs for the Fastify proxy
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
      const html = await this._fetch(url); // Using helper
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const results = [];

      doc.querySelectorAll(".image-list span").forEach((e) => {
        const id = e.getAttribute("id")?.replace("s", "");
        const img = e.querySelector("img");
        let thumb = img?.getAttribute("src");

        if (thumb && !thumb.startsWith("http")) thumb = `https:${thumb}`;
        const tags = img
          ?.getAttribute("alt")
          ?.trim()
          .split(" ")
          .filter(Boolean);

        if (id && thumb) {
          results.push({ id, thumb, tags });
        }
      });

      return { results, hasNext: results.length >= perPage };
    } catch (err) {
      console.error("Fetch failed through proxy:", err);
      return { results: [] };
    }
  }

  async getTrendingTags() {
    try {
      const url = `${this.baseUrl}/index.php?page=post&s=list`;
      const html = await this._fetch(url); // Using helper
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const tags = [];

      doc.querySelectorAll("#tag-sidebar li").forEach((li) => {
        const nameAnchor = li.querySelector('a[href*="tags="]');
        const countSpan =
          li.querySelector(".tag-count") || li.querySelector("span");

        if (nameAnchor) {
          const type = li.className.replace("tag-type-", "").trim();
          let tagName = nameAnchor.innerText.replace(/\?/g, "").trim();
          tagName = tagName.replace(/\s+/g, "_").replace(/,/g, "");
          let tagCount = countSpan ? countSpan.innerText : "";
          tagCount = tagCount.replace(/[(),]/g, "");

          tags.push({
            name: tagName,
            count: tagCount,
            type: type || "general",
          });
        }
      });

      return tags.filter((t) => t.name.length > 0).slice(0, 25);
    } catch (err) {
      console.error("Sidebar Sync Failed:", err);
      return [];
    }
  }

  async getPostDetails(id) {
    const url = `${this.baseUrl}/index.php?page=post&s=view&id=${id}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const html = await this._fetch(url, controller.signal); // Using helper
      clearTimeout(timeout);

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const comments = [];
      const seenIds = new Set();
      const commentElements = doc.querySelectorAll(
        "#post-comments div[id^='c'], #comment-list div[id^='c']",
      );

      commentElements.forEach((comm) => {
        const cId = comm.id;
        if (!cId || seenIds.has(cId) || cId === "comment-list") return;

        const authorEl = comm.querySelector(".col1 a");
        const bodyEl = comm.querySelector(".col2");

        if (authorEl && bodyEl) {
          const author = authorEl.innerText.trim();
          const body = bodyEl.innerText.trim();
          if (author && body) {
            comments.push({ author, body });
            seenIds.add(cId);
          }
        }
      });

      let fullImage = doc.querySelector("#image, #video")?.src || "";
      // Fix for relative URLs
      if (fullImage && fullImage.startsWith("/")) {
        fullImage = `https://rule34.xxx${fullImage}`;
      }

      return {
        fullImage,
        tags: Array.from(doc.querySelectorAll("#tag-sidebar li"))
          .map((li) => ({
            name: li
              .querySelector('a[href*="tags="]')
              ?.innerText.replace(/\?/g, "")
              .trim()
              .replace(/\s+/g, "_"),
            type: li.className.replace("tag-type-", "").trim(),
          }))
          .filter((t) => t.name),
        comments,
      };
    } catch (err) {
      console.error("Scrape failed:", err);
      return null;
    }
  }
}

window.Nexus.register(Rule34);
