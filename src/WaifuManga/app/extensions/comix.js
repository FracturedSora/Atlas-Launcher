/**
 * Nexus Extension for Comix.to
 * Scraping logic is 1:1 with the Seanime Provider implementation.
 * Now includes robust dynamic language filtering based on user settings.
 */
class ComixProvider {
  constructor() {
    this.baseUrl = "https://comix.to";
    this.apiUrl = "https://comix.to/api/v2";
    this.name = "Comix";
    this.type = "sfw";
    this.icon = "https://comix.to/favicon.ico";
    this.format = "manga";
  }

  // ─── Search ──────────────────────────────────────────────────────────────
  async search(query, page) {
    if (query === undefined) query = "";
    if (page === undefined) page = 1;
    var url =
      this.apiUrl +
      "/manga?keyword=" +
      encodeURIComponent(query) +
      "&order[relevance]=desc&page=" +
      page;

    try {
      var response = await fetch(url);
      if (!response.ok) return { results: [], hasNext: false };

      var data = await response.json();
      if (!data.result || !data.result.items)
        return { results: [], hasNext: false };

      var results = data.result.items.map(function (item) {
        var compositeId = item.hash_id + "|" + item.slug;
        var thumb = "";
        if (item.poster) {
          thumb =
            item.poster.medium || item.poster.large || item.poster.small || "";
        }
        return {
          id: compositeId,
          title: item.title,
          thumb: thumb,
          description: item.summary || "",
          type: "manga",
        };
      });

      var lastPage =
        data.result.pagination && data.result.pagination.last_page
          ? data.result.pagination.last_page
          : 1;
      return { results: results, hasNext: lastPage > page };
    } catch (e) {
      console.error("Comix search failed:", e.message);
      return { results: [], hasNext: false };
    }
  }

  // ─── Extract chapter number (1:1 Seanime) ────────────────────────────────
  extractChapterNumber(chapterStr) {
    var num = parseFloat(chapterStr);
    if (!isNaN(num)) return num;
    var match = String(chapterStr).match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
  }

  // ─── Deduplicate chapters (1:1 Seanime) ──────────────────────────────────
  deduplicateChapters(chapters) {
    var self = this;
    var chapterMap = new Map();

    chapters.forEach(function (chapter) {
      var key = self.extractChapterNumber(chapter.chapter).toString();

      if (!chapterMap.has(key)) {
        chapterMap.set(key, Object.assign({}, chapter));
      } else {
        var existing = chapterMap.get(key);

        var combinedScanlator = existing.scanlator;
        if (chapter.scanlator && existing.scanlator) {
          var existingList = existing.scanlator.split(", ");
          if (existingList.indexOf(chapter.scanlator) === -1) {
            combinedScanlator = existing.scanlator + ", " + chapter.scanlator;
          }
        } else if (chapter.scanlator && !existing.scanlator) {
          combinedScanlator = chapter.scanlator;
        }

        var existingHasTitle = existing.title.indexOf(" — ") !== -1;
        var currentHasTitle = chapter.title.indexOf(" — ") !== -1;

        if (currentHasTitle && !existingHasTitle) {
          var merged = Object.assign({}, chapter);
          merged.scanlator = combinedScanlator;
          chapterMap.set(key, merged);
        } else {
          existing.scanlator = combinedScanlator;
        }
      }
    });

    return Array.from(chapterMap.values());
  }

  // ─── findChapters (1:1 Seanime + Robust Language Filter) ─────────────────
  async findChapters(mangaId) {
    var parts = mangaId.split("|");
    var hashId = parts[0];
    var slug = parts[1];
    if (!hashId || !slug) return [];

    // Retrieve the user's preferred language, defaulting to English ('en')
    var targetLang = localStorage.getItem("language") || "en";

    var baseUrl =
      this.apiUrl +
      "/manga/" +
      hashId +
      "/chapters?order[number]=desc&limit=100";
    var self = this;

    try {
      var firstRes = await fetch(baseUrl);
      var firstData = await firstRes.json();

      if (!firstData.result || !firstData.result.items) return [];

      var totalPages =
        firstData.result.pagination && firstData.result.pagination.last_page
          ? firstData.result.pagination.last_page
          : 1;
      var allChapters = firstData.result.items.slice();

      // Fetch remaining pages sequentially (1:1 Seanime)
      for (var page = 2; page <= totalPages; page++) {
        var pageRes = await fetch(baseUrl + "&page=" + page);
        var pageData = await pageRes.json();
        if (
          pageData.result &&
          pageData.result.items &&
          pageData.result.items.length > 0
        ) {
          allChapters = allChapters.concat(pageData.result.items);
        }
      }

      // ─── ROBUST LANGUAGE NORMALIZATION ───
      // Handles 'jp' vs 'ja', 'en-US' vs 'en', and missing values
      var normalizeLang = function (langCode) {
        if (!langCode) return "en"; // Default empty/null to English
        var l = langCode.toLowerCase().trim();
        if (l === "jp") return "ja"; // Map 'jp' to 'ja' standard
        return l.split("-")[0]; // Convert 'en-us' or 'en-gb' to 'en'
      };

      var userLang = normalizeLang(targetLang);

      var filteredChapters = allChapters.filter(function (item) {
        var itemLang = normalizeLang(item.language);
        return itemLang === userLang;
      });

      // Map items
      var chapters = filteredChapters.map(function (item) {
        var compositeChapterId =
          hashId + "|" + slug + "|" + item.chapter_id + "|" + item.number;

        var chapterTitle =
          item.name && item.name.trim().length > 0
            ? "Chapter " + item.number + " \u2014 " + item.name
            : "Chapter " + item.number;

        var scanlator;
        if (item.is_official === 1) {
          scanlator = "Official";
        } else if (
          item.scanlation_group &&
          item.scanlation_group.name &&
          item.scanlation_group.name.trim()
        ) {
          scanlator = item.scanlation_group.name.trim();
        } else {
          scanlator = undefined;
        }

        return {
          id: compositeChapterId,
          url:
            self.baseUrl +
            "/title/" +
            hashId +
            "-" +
            slug +
            "/" +
            item.chapter_id +
            "-chapter-" +
            item.number,
          title: chapterTitle,
          chapter: String(item.number),
          number: item.number,
          index: 0,
          scanlator: scanlator,
          date: item.created_at || item.updated_at || null,
          language: item.language,
        };
      });

      // 1:1 Seanime post-processing
      chapters = this.deduplicateChapters(chapters);

      // Sort descending
      chapters.sort(function (a, b) {
        return (
          self.extractChapterNumber(b.chapter) -
          self.extractChapterNumber(a.chapter)
        );
      });

      // Reverse so Chapter 1 is at index 0
      chapters.reverse();

      // Set index
      chapters.forEach(function (chapter, i) {
        chapter.index = i;
      });

      return chapters;
    } catch (e) {
      console.error("Comix findChapters failed:", e.message);
      return [];
    }
  }

  // ─── getChapters — Nexus /api/chapters wrapper ───────────────────────────
  async getChapters(mangaId) {
    var chapters = await this.findChapters(mangaId);
    return { chapters: chapters };
  }

  // ─── getPostDetails ───────────────────────────────────────────────────────
  async getPostDetails(mangaId) {
    var hashId = mangaId.split("|")[0];
    try {
      var infoRes = await fetch(this.apiUrl + "/manga/" + hashId);
      var infoData = await infoRes.json();
      var tags = (
        infoData.result && infoData.result.genres ? infoData.result.genres : []
      ).map(function (g) {
        return { name: g.name, type: "genre" };
      });
      var chapters = await this.findChapters(mangaId);
      return { tags: tags, chapters: chapters, type: "manga" };
    } catch (e) {
      console.error("Comix getPostDetails failed:", e.message);
      return { tags: [], chapters: [], type: "manga" };
    }
  }

  // ─── getChapterPages (1:1 Seanime findChapterPages) ──────────────────────
  async getChapterPages(chapterId) {
    var parts = chapterId.split("|");
    if (parts.length < 4) return [];

    var hashId = parts[0];
    var slug = parts[1];
    var specificChapterId = parts[2];
    var number = parts[3];
    var url =
      this.baseUrl +
      "/title/" +
      hashId +
      "-" +
      slug +
      "/" +
      specificChapterId +
      "-chapter-" +
      number;

    try {
      var response = await fetch(url);
      var body = await response.text();

      // 1:1 Seanime regex
      var regex = /["\\]*images["\\]*\s*:\s*(\[[^\]]*\])/s;
      var match = body.match(regex);
      if (!match || !match[1]) return [];

      var images = [];
      try {
        images = JSON.parse(match[1]);
      } catch (e1) {
        try {
          images = JSON.parse(match[1].replace(/\\"/g, '"'));
        } catch (e2) {
          return [];
        }
      }

      return images.map(function (img) {
        return (
          "/api/proxy?url=" +
          encodeURIComponent(img.url) +
          "&referer=" +
          encodeURIComponent(url)
        );
      });
    } catch (e) {
      console.error("Comix getChapterPages failed:", e.message);
      return [];
    }
  }
}

// Register to Nexus
window.Nexus.register(ComixProvider);
