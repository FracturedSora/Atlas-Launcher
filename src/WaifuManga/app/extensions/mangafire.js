class MangaFire {
  constructor() {
    this.baseUrl = "https://mangafire.to";
    this.name = "MangaFire";
    this.type = "sfw";
    this.format = "manga";
    this.logo =
      "https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://mangafire.to&size=16";

    this.headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Referer: "https://mangafire.to/",
    };

    // ── VRF crypto tables ──────────────────────────────────────────────────
    this._rc4Keys = {
      l: "FgxyJUQDPUGSzwbAq/ToWn4/e8jYzvabE+dLMb1XU1o=",
      g: "CQx3CLwswJAnM1VxOqX+y+f3eUns03ulxv8Z+0gUyik=",
      B: "fAS+otFLkKsKAJzu3yU+rGOlbbFVq+u+LaS6+s1eCJs=",
      m: "Oy45fQVK9kq9019+VysXVlz1F9S1YwYKgXyzGlZrijo=",
      F: "aoDIdXezm2l3HrcnQdkPJTDT8+W6mcl2/02ewBHfPzg=",
    };

    this._seeds32 = {
      A: "yH6MXnMEcDVWO/9a6P9W92BAh1eRLVFxFlWTHUqQ474=",
      V: "RK7y4dZ0azs9Uqz+bbFB46Bx2K9EHg74ndxknY9uknA=",
      N: "rqr9HeTQOg8TlFiIGZpJaxcvAaKHwMwrkqojJCpcvoc=",
      P: "/4GPpmZXYpn5RpkP7FC/dt8SXz7W30nUZTe8wb+3xmU=",
      k: "wsSGSBXKWA9q1oDJpjtJddVxH+evCfL5SO9HZnUDFU8=",
    };

    this._prefixKeys = {
      O: "l9PavRg=",
      v: "Ml2v7ag1Jg==",
      L: "i/Va0UxrbMo=",
      p: "WFjKAHGEkQM=",
      W: "5Rr27rWd",
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  // ── search ──────────────────────────────────────────────────────
  async search(query, page, contentType) {
    try {
      var trimmed = query.trim();
      var keyword = query.replaceAll(" ", "+");
      var vrf = this._generateVrf(trimmed);
      var url =
        this.baseUrl + "/ajax/manga/search?keyword=" + keyword + "&vrf=" + vrf;

      var res = await fetch(url);
      var data = await res.json();

      if (!data || !data.result || !data.result.html) return { results: [] };

      var $ = cheerio.load(data.result.html);
      var results = [];

      $("a.unit").each(function (i, el) {
        var href = $(el).attr("href") || "";
        var id = href.replace("/manga/", "").replace(/^\//, "");
        var title = $(el).find("h6").text().trim();
        var thumb =
          $(el).find("img").attr("src") ||
          $(el).find("img").attr("data-src") ||
          "";

        if (id && title) {
          results.push({
            id: id,
            title: title,
            thumb: thumb,
            type: "manga",
          });
        }
      });

      console.log(
        '[MangaFire] search "' + query + '" -> ' + results.length + " results",
      );
      return { results: results, hasNext: false };
    } catch (e) {
      console.error("[MangaFire] search failed:", e.message);
      return { results: [] };
    }
  }

  // ── getChapters ─────────────────────────────────────────────────
  async getChapters(mangaId) {
    try {
      var res = await fetch(this.baseUrl + "/manga/" + mangaId);
      var html = await res.text();

      var langCodes = this._extractLanguageCodes(html);
      var allChapters = [];

      for (var i = 0; i < langCodes.length; i++) {
        var chapters = await this._fetchChaptersForLanguage(
          mangaId,
          langCodes[i],
        );
        allChapters = allChapters.concat(chapters);
      }

      console.log(
        "[MangaFire] " +
          mangaId +
          " -> " +
          allChapters.length +
          " chapters across " +
          langCodes.length +
          " language(s)",
      );
      return { chapters: allChapters };
    } catch (e) {
      console.error("[MangaFire] getChapters failed:", e.message);
      return { chapters: [] };
    }
  }

  // ── getPostDetails ──────────────────────────────────────────────
  async getPostDetails(mangaId) {
    try {
      var res = await fetch(this.baseUrl + "/manga/" + mangaId);
      var html = await res.text();
      var $ = cheerio.load(html);

      var title =
        $("h1.name").text().trim() ||
        $(".manga-name h1").text().trim() ||
        mangaId;
      var description =
        $(".synopsis p").text().trim() || $(".description").text().trim() || "";
      var thumb =
        $(".manga-poster img").attr("src") ||
        $(".poster img").attr("src") ||
        "";
      var status = $(".item:contains('Status') .name").text().trim() || "";

      var tags = [];
      $(".genre a, .genres a").each(function (i, el) {
        var g = $(el).text().trim();
        if (g) tags.push({ name: g, type: "genre" });
      });

      var chaptersResult = await this.getChapters(mangaId);

      return {
        id: mangaId,
        title: title,
        description: description,
        thumb: thumb,
        status: status,
        tags: tags,
        chapters: chaptersResult.chapters,
        type: "manga",
      };
    } catch (e) {
      console.error("[MangaFire] getPostDetails failed:", e.message);
      return { id: mangaId, title: mangaId, chapters: [], tags: [] };
    }
  }

  // ── getChapterPages ─────────────────────────────────────────────
  async getChapterPages(chapterId) {
    try {
      var vrf = this._generateVrf("chapter@" + chapterId);
      var url =
        this.baseUrl + "/ajax/read/chapter/" + chapterId + "?vrf=" + vrf;

      var res = await fetch(url);
      var data = await res.json();
      var images = data.result && data.result.images;

      if (!images || !images.length) return [];

      var pages = images.map(function (img, i) {
        return {
          url: Array.isArray(img) ? img[0] : img,
          index: i,
          headers: { Referer: "https://mangafire.to/" },
        };
      });

      console.log(
        "[MangaFire] chapter " + chapterId + " -> " + pages.length + " pages",
      );
      return pages;
    } catch (e) {
      console.error("[MangaFire] getChapterPages failed:", e.message);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════

  _extractLanguageCodes(html) {
    var $ = cheerio.load(html);
    var langMap = {};

    $("[data-code][data-title]").each(function (i, el) {
      var code = ($(el).attr("data-code") || "").toLowerCase();
      var title = $(el).attr("data-title") || "";

      if (code === "es" && title.includes("LATAM")) code = "es-la";
      else if (code === "pt" && title.toLowerCase().includes("br"))
        code = "pt-br";

      langMap[code] = code;
    });

    return Object.keys(langMap);
  }

  async _fetchChaptersForLanguage(mangaId, lang) {
    try {
      var shortId = mangaId.split(".").pop() || mangaId;
      var vrf = this._generateVrf(shortId + "@chapter@" + lang);
      var url =
        this.baseUrl +
        "/ajax/read/" +
        shortId +
        "/chapter/" +
        lang +
        "?vrf=" +
        vrf;

      var res = await fetch(url);
      var data = await res.json();
      var html = (data.result && data.result.html) || "";

      if (!html) return [];

      var $ = cheerio.load(html);
      var chapters = [];

      $("a[data-number][data-id]").each(function (i, el) {
        var id = $(el).attr("data-id") || "";
        var number = $(el).attr("data-number") || "";
        var title = $(el).attr("title") || "";
        var langIso = lang;

        if (id) {
          chapters.push({
            id: id,
            title: title,
            index: 0,
            chapter: number,
            language: langIso,
          });
        }
      });

      chapters.reverse();
      chapters.forEach(function (ch, i) {
        ch.index = i;
        if (!ch.title) ch.title = "Chapter " + (i + 1);
      });

      return chapters;
    } catch (e) {
      console.error(
        "[MangaFire] fetchChaptersForLanguage(" + lang + ") failed:",
        e.message,
      );
      return [];
    }
  }

  // ─── VRF crypto ──────────────────────────────────────────────────────────

  _generateVrf(input) {
    var scheduleC = [
      this._sub8(223),
      this._rotr8(4),
      this._rotr8(4),
      this._add8(234),
      this._rotr8(7),
      this._rotr8(2),
      this._rotr8(7),
      this._sub8(223),
      this._rotr8(7),
      this._rotr8(6),
    ];
    var scheduleY = [
      this._add8(19),
      this._rotr8(7),
      this._add8(19),
      this._rotr8(6),
      this._add8(19),
      this._rotr8(1),
      this._add8(19),
      this._rotr8(6),
      this._rotr8(7),
      this._rotr8(4),
    ];
    var scheduleB = [
      this._sub8(223),
      this._rotr8(1),
      this._add8(19),
      this._sub8(223),
      this._rotl8(2),
      this._sub8(223),
      this._add8(19),
      this._rotl8(1),
      this._rotl8(2),
      this._rotl8(1),
    ];
    var scheduleJ = [
      this._add8(19),
      this._rotl8(1),
      this._rotl8(1),
      this._rotr8(1),
      this._add8(234),
      this._rotl8(1),
      this._sub8(223),
      this._rotl8(6),
      this._rotl8(4),
      this._rotl8(1),
    ];
    var scheduleE = [
      this._rotr8(1),
      this._rotl8(1),
      this._rotl8(6),
      this._rotr8(1),
      this._rotl8(2),
      this._rotr8(4),
      this._rotl8(1),
      this._rotl8(1),
      this._sub8(223),
      this._rotl8(2),
    ];

    var bytes = this._textEncode(encodeURIComponent(input));

    // Stage 1
    bytes = this._rc4(this._b64Decode(this._rc4Keys["l"]), bytes);
    var prefO = this._b64Decode(this._prefixKeys["O"]);
    bytes = this._transform(
      bytes,
      this._b64Decode(this._seeds32["A"]),
      prefO,
      prefO.length,
      scheduleC,
    );

    // Stage 2
    bytes = this._rc4(this._b64Decode(this._rc4Keys["g"]), bytes);
    var prefV = this._b64Decode(this._prefixKeys["v"]);
    bytes = this._transform(
      bytes,
      this._b64Decode(this._seeds32["V"]),
      prefV,
      prefV.length,
      scheduleY,
    );

    // Stage 3
    bytes = this._rc4(this._b64Decode(this._rc4Keys["B"]), bytes);
    var prefL = this._b64Decode(this._prefixKeys["L"]);
    bytes = this._transform(
      bytes,
      this._b64Decode(this._seeds32["N"]),
      prefL,
      prefL.length,
      scheduleB,
    );

    // Stage 4
    bytes = this._rc4(this._b64Decode(this._rc4Keys["m"]), bytes);
    var prefP = this._b64Decode(this._prefixKeys["p"]);
    bytes = this._transform(
      bytes,
      this._b64Decode(this._seeds32["P"]),
      prefP,
      prefP.length,
      scheduleJ,
    );

    // Stage 5
    bytes = this._rc4(this._b64Decode(this._rc4Keys["F"]), bytes);
    var prefW = this._b64Decode(this._prefixKeys["W"]);
    bytes = this._transform(
      bytes,
      this._b64Decode(this._seeds32["k"]),
      prefW,
      prefW.length,
      scheduleE,
    );

    return this._b64Encode(bytes)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  _textEncode(str) {
    return Uint8Array.from(Buffer.from(str, "utf-8"));
  }

  _b64Decode(str) {
    return Uint8Array.from(Buffer.from(str, "base64"));
  }

  _b64Encode(bytes) {
    return Buffer.from(bytes).toString("base64");
  }

  _add8(n) {
    return function (c) {
      return (c + n) & 0xff;
    };
  }
  _sub8(n) {
    return function (c) {
      return (c - n + 256) & 0xff;
    };
  }
  _xor8(n) {
    return function (c) {
      return (c ^ n) & 0xff;
    };
  }
  _rotl8(n) {
    return function (c) {
      return ((c << n) | (c >> (8 - n))) & 0xff;
    };
  }
  _rotr8(n) {
    return function (c) {
      return ((c >> n) | (c << (8 - n))) & 0xff;
    };
  }

  _rc4(key, input) {
    var s = new Uint8Array(256);
    for (var i = 0; i < 256; i++) s[i] = i;

    var j = 0;
    for (var i = 0; i < 256; i++) {
      j = (j + s[i] + key[i % key.length]) & 0xff;
      var tmp = s[i];
      s[i] = s[j];
      s[j] = tmp;
    }

    var output = new Uint8Array(input.length);
    var ii = 0,
      jj = 0;
    for (var y = 0; y < input.length; y++) {
      ii = (ii + 1) & 0xff;
      jj = (jj + s[ii]) & 0xff;
      var tmp = s[ii];
      s[ii] = s[jj];
      s[jj] = tmp;
      var k = s[(s[ii] + s[jj]) & 0xff];
      output[y] = input[y] ^ k;
    }

    return output;
  }

  _transform(input, initSeedBytes, prefixKeyBytes, prefixLen, schedule) {
    var out = [];
    for (var i = 0; i < input.length; i++) {
      if (i < prefixLen) {
        out.push(prefixKeyBytes[i] || 0);
      }
      var transformed =
        schedule[i % 10]((input[i] ^ initSeedBytes[i % 32]) & 0xff) & 0xff;
      out.push(transformed);
    }
    return new Uint8Array(out);
  }
}

window.Nexus.register(MangaFire);
