class Gelbooru {
  constructor() {
    this.baseUrl = "https://gelbooru.com";
    this.name = "Gelbooru";
    this.type = "nsfw";
    this.logo = "https://gelbooru.com/favicon.png";
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

      doc.querySelectorAll("article.thumbnail-preview").forEach((article) => {
        const anchor = article.querySelector("a[id^='p']");
        const id = anchor?.getAttribute("id")?.replace("p", "");
        const img = article.querySelector("img");
        let thumb = img?.getAttribute("src");

        if (thumb && !thumb.startsWith("http")) thumb = `https:${thumb}`;

        const tags = img
          ?.getAttribute("alt")
          ?.replace(/^Gelbooru \|\s*/, "")
          .trim()
          .split(" ");

        if (id && thumb) {
          results.push({ id, thumb, tags });
        }
      });

      return { results, hasNext: results.length >= perPage };
    } catch (err) {
      console.error("Gelbooru Search Error:", err);
      return { results: [] };
    }
  }

  async getTrendingTags() {
    try {
      const url = `${this.baseUrl}/index.php?page=post&s=list`;
      const html = await this._fetch(url);
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const tags = [];

      // FIX: Gelbooru sidebar tags are usually in a tag-list class
      // We look for the anchor inside the list item
      doc.querySelectorAll("#tag-sidebar li, .tag-list li").forEach((li) => {
        const nameAnchor = li.querySelector('a[href*="tags="]');

        if (nameAnchor) {
          // Gelbooru uses "tag-type-artist" etc.
          const typeMatch = li.className.match(/tag-type-(\w+)/);
          const type = typeMatch ? typeMatch[1] : "general";

          let tagName = nameAnchor.textContent.trim().replace(/\?/g, "");

          // Gelbooru often puts the count in a text node or span next to the anchor
          let tagCount = li.textContent.match(/\(([\d,]+)\)/)?.[1] || "";

          tags.push({
            name: tagName.replace(/\s+/g, "_"),
            count: tagCount,
            type: type,
          });
        }
      });

      return tags.filter((t) => t.name.length > 1).slice(0, 25);
    } catch (err) {
      console.error("Gelbooru Trending Error:", err);
      return [];
    }
  }

  async getPostDetails(id) {
    // Ensure the ID is clean
    const cleanId = id.toString().replace(/\D/g, "");
    const url = `${this.baseUrl}/index.php?page=post&s=view&id=${cleanId}`;

    try {
      const html = await this._fetch(url);
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // 1. Metadata Tags (Sidebar)
      const tagList = Array.from(
        doc.querySelectorAll("#tag-sidebar li, .tag-list li"),
      )
        .map((li) => {
          const anchor = li.querySelector('a[href*="tags="]');
          if (!anchor) return null;

          const typeMatch = li.className.match(/tag-type-(\w+)/);
          const type = typeMatch ? typeMatch[1] : "general";

          return {
            name: anchor.textContent
              .trim()
              .replace(/\?/g, "")
              .replace(/\s+/g, "_"),
            type: type,
          };
        })
        .filter((t) => t && t.name && t.name !== "tags");

      // 2. Comments
      const comments = [];
      doc
        .querySelectorAll(".comment-container, div[id^='c']")
        .forEach((comm) => {
          const authorEl = comm.querySelector(".comment-author, b");
          const bodyEl = comm.querySelector(
            ".comment-body, div[id^='comment-body']",
          );

          if (authorEl && bodyEl) {
            const author = authorEl.innerText.trim();
            const body = bodyEl.innerText.replace(/Quote/g, "").trim();
            if (author && body) comments.push({ author, body });
          }
        });

      // 3. GIF & Image Extraction Logic
      // We look for the "Original image" link or the 'data-file-url'
      // This ensures we get the .gif file instead of a .mp4 preview.
      const originalLink = doc.querySelector(
        'a[href*="/images/"]:not([href*="sample"])',
      );
      const imageContainer = doc.querySelector("section.image-container");
      const imageElement = doc.querySelector("#image");

      let fullImage =
        imageContainer?.getAttribute("data-file-url") || // Modern Gelbooru
        originalLink?.getAttribute("href") || // Direct file link
        imageElement?.getAttribute("src") || // Fallback to visible image
        "";

      // Protocol Fixing
      if (fullImage.startsWith("//")) {
        fullImage = "https:" + fullImage;
      } else if (fullImage.startsWith("/") && !fullImage.startsWith("//")) {
        fullImage = "https://gelbooru.com" + fullImage;
      }

      // Double-slash cleanup to prevent load errors
      fullImage = fullImage.replace(/(https?:\/\/)|(\/)+/g, "$1$2");

      // Important: We encode it for the proxy as your modal expects
      return {
        fullImage: encodeURIComponent(fullImage),
        tags: tagList,
        comments,
      };
    } catch (err) {
      console.error("Gelbooru Modal Load Error:", err);
      return null;
    }
  }
}

window.Nexus.register(Gelbooru);
