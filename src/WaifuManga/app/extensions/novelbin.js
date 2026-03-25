class NovelBin {
  constructor() {
    this.baseUrl = "https://novelbin.me";
    this.name = "NovelBin";
    this.type = "nsfw";
    this.format = "novel";
    this.logo = "https://novelbin.me/favicon.ico";

    this.headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      Referer: "https://novelbin.me/",
    };
  }

  // ─── search ────────────────────────────────────────────────────────────────
  async search(query, page, contentType) {
    page = page || 1;
    try {
      var resp = await fetch(
        this.baseUrl +
          "/search?keyword=" +
          encodeURIComponent(query) +
          "&page=" +
          page,
        { headers: this.headers },
      );
      var html = await resp.text();
      var $ = cheerio.load(html);
      var results = [];

      $(".col-novel-main .list-novel .row").each(function (i, el) {
        var titleEl = $(el).find(".novel-title a");
        var url = titleEl.attr("href") || "";
        var id = url.split("/").filter(Boolean).pop() || "";
        var title = titleEl.text().trim();
        var thumb =
          $(el).find("img.cover").attr("data-src") ||
          $(el).find("img.cover").attr("src") ||
          "";
        var rating = $(el).find(".small").text().trim() || "";

        if (id && title) {
          results.push({
            id: id,
            title: title,
            thumb: thumb,
            description: rating ? "Rating: " + rating : "",
            type: "novel",
          });
        }
      });

      return { results: results, hasNext: false };
    } catch (e) {
      console.error("[NovelBin] search failed:", e.message);
      return { results: [] };
    }
  }

  async getPostDetails(novelSlug) {
    try {
      const resp = await fetch(`${this.baseUrl}/novel-book/${novelSlug}`, {
        headers: this.headers,
      });
      const html = await resp.text();
      const $ = cheerio.load(html);

      // FIX DOUBLE TITLE: Target the specific h3 inside the desc-book
      const novelTitle = $(".desc-book h3.title").first().text().trim();

      // FIX IMAGE: Get the specific cover image
      const thumb =
        $(".book img").attr("data-src") || $(".book img").attr("src") || "";

      // GET CHAPTERS: Use the slug directly since your HAR log proved it works
      console.log(`[NovelBin] Fetching chapters for: ${novelSlug}`);
      const chapters = await this._fetchChapterList(novelSlug);

      // LOG FOR DEBUGGING: Check your terminal/console for this!
      console.log(
        `[NovelBin] Scraped ${chapters.length} chapters successfully.`,
      );

      // THE RETURN: Ensure these keys match exactly what your app's "Data" object wants
      return {
        id: novelSlug,
        title: novelTitle,
        thumb: thumb,
        headerImageUrl: thumb, // Some apps use this for the banner
        description: $(".desc-text").text().trim(),
        chapters: chapters, // This must be an array of objects
        type: "novel",
        status: "Ongoing",
      };
    } catch (e) {
      console.error(
        "[NovelBin] Critical failure in getPostDetails:",
        e.message,
      );
      return { id: novelSlug, chapters: [], type: "novel" };
    }
  }

  // ─── _fetchChapterList ─────────────────────────────────────────────────────
  async _fetchChapterList(novelSlug, identifier) {
    try {
      const ajaxHeaders = {
        ...this.headers,
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${this.baseUrl}/novel-book/${novelSlug}`,
      };

      // We use the slug directly as the novelId since your log shows it works
      const url = `${this.baseUrl}/ajax/chapter-archive?novelId=${novelSlug}`;

      const resp = await fetch(url, { headers: ajaxHeaders });
      const html = await resp.text();

      // If the HTML is empty or just <body></body>, stop here
      if (!html || html.length < 100) {
        console.error("[NovelBin] AJAX returned empty or invalid HTML");
        return [];
      }

      const $ = cheerio.load(html);
      const chapters = [];

      // Target the links directly by the class seen in your log
      const links = $("li a");

      links.each((i, el) => {
        const $el = $(el);
        const fullHref = $el.attr("href") || "";

        // Clean up the title - your log shows lots of newlines/spaces
        let title =
          $el.find(".chapter-title").text().trim() ||
          $el.attr("title") ||
          $el.text().trim();

        if (fullHref) {
          // Extract the last part of the URL regardless of the prefix
          // https://novelbin.me/novel-book/slug/chapter-1 -> chapter-1
          const parts = fullHref.split("/").filter(Boolean);
          const chapterSlug = parts.pop();

          chapters.push({
            id: novelSlug + "/" + chapterSlug,
            title: title,
            index: i,
          });
        }
      });

      console.log(`[NovelBin] Scraper found ${chapters.length} chapters.`);
      return chapters;
    } catch (e) {
      console.error("[NovelBin] Chapter AJAX failed:", e.message);
      return [];
    }
  }

  // ─── getChapters ───────────────────────────────────────────────────────────
  async getChapters(id) {
    const chapters = await this._fetchChapterList(id);
    return { chapters };
  }

  // ─── getChapterContent ─────────────────────────────────────────────────────
  async getChapterContent(chapterId) {
    try {
      var resp = await fetch(this.baseUrl + "/b/" + chapterId, {
        headers: this.headers,
      });
      var html = await resp.text();
      var $ = cheerio.load(html);

      var contentEl = $("#chr-content");

      // Cleanup: Remove ads, scripts, and hidden trap elements
      contentEl
        .find("script, style, ins, .ads, .adsbox, .chapter-nav, noscript")
        .remove();

      // Filter out hidden elements that might contain "stolen from" watermarks
      contentEl.find("*").each((i, el) => {
        const style = $(el).attr("style") || "";
        if (style.includes("display: none") || style.includes("font-size: 0")) {
          $(el).remove();
        }
      });

      var paragraphs = [];
      contentEl.find("p").each(function (i, el) {
        var text = $(el).text().trim();
        if (text.length > 1) paragraphs.push(text);
      });

      if (!paragraphs.length) {
        paragraphs = contentEl
          .text()
          .split(/\n+/)
          .map((l) => l.trim())
          .filter((l) => l.length > 1);
      }

      var chapterTitle =
        $(".chr-title").text().trim() || $("h2").first().text().trim() || "";
      return (
        (chapterTitle ? chapterTitle + "\n\n" : "") + paragraphs.join("\n\n")
      );
    } catch (e) {
      console.error("[NovelBin] getChapterContent failed:", e.message);
      return "";
    }
  }
}

window.Nexus.register(NovelBin);
