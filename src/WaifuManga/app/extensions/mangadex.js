class MangaDex {
  constructor() {
    this.baseUrl = "https://api.mangadex.org";
    this.name = "MangaDex";
    this.type = "sfw";
    this.format = "manga";
    this.logo = "https://mangadex.org/favicon.ico";
  }

  /**
   * Searches for Manga series.
   * Results populate the main library grid.
   */
  async search(query = "", page = 1) {
    const limit = 24;
    const offset = (page - 1) * limit;

    // Builds search URL with cover art and content rating filters
    const url = `${this.baseUrl}/manga?limit=${limit}&offset=${offset}&title=${encodeURIComponent(query)}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      const results = data.data.map((manga) => {
        // Find the cover art relationship to get the filename
        const coverArt = manga.relationships.find(
          (r) => r.type === "cover_art",
        );
        const fileName = coverArt ? coverArt.attributes.fileName : "";

        // MangaDex covers follow a specific URL pattern
        const thumb = fileName
          ? `https://uploads.mangadex.org/covers/${manga.id}/${fileName}.256.jpg`
          : "https://via.placeholder.com/256x360?text=No+Cover";

        return {
          id: manga.id,
          thumb: thumb,
          title:
            manga.attributes.title.en ||
            Object.values(manga.attributes.title)[0] ||
            "Unknown Title",
          // Baked metadata for the reader overview
          description:
            manga.attributes.description.en || "No description available.",
          type: "manga",
        };
      });

      return {
        results,
        hasNext: data.total > offset + limit,
      };
    } catch (err) {
      console.error("MangaDex Search failed:", err);
      return { results: [] };
    }
  }

  /**
   * Fetches the chapter list and book metadata for the modal sidebar.
   */
  async getPostDetails(id) {
    try {
      // 1. Get Manga Attributes for tags
      const mangaResp = await fetch(`${this.baseUrl}/manga/${id}`);
      const mangaData = await mangaResp.json();
      const tags = mangaData.data.attributes.tags.map((t) => ({
        name: t.attributes.name.en,
        type: "general",
      }));

      // 2. Get English chapters (sorted descending)
      const feedUrl = `${this.baseUrl}/manga/${id}/feed?translatedLanguage[]=en&order[chapter]=desc&limit=100`;
      const feedResp = await fetch(feedUrl);
      const feedData = await feedResp.json();

      const chapters = feedData.data.map((ch) => ({
        id: ch.id,
        title: ch.attributes.chapter
          ? `Chapter ${ch.attributes.chapter}${ch.attributes.title ? ": " + ch.attributes.title : ""}`
          : ch.attributes.title || "Oneshot",
      }));

      return {
        tags: tags,
        chapters: chapters,
        type: "manga",
      };
    } catch (e) {
      console.error("MangaDex Details failed:", e);
      return { tags: [], chapters: [], type: "manga" };
    }
  }

  /**
   * Fetches page URLs for a specific chapter.
   * Uses your server.js proxy to bypass MangaDex image restrictions.
   */
  async getChapterPages(chapterId) {
    try {
      const resp = await fetch(`${this.baseUrl}/at-home/server/${chapterId}`);
      const data = await resp.json();
      const hash = data.chapter.hash;

      // Constructs the full URLs for the images on the MangaDex@Home network
      return data.chapter.data.map(
        (page) => `${data.baseUrl}/data/${hash}/${page}`,
      );
    } catch (e) {
      console.error("MangaDex Pages failed:", e);
      return [];
    }
  }

  /**
   * Maps MangaDex genres to the sidebar.
   */
  async getTrendingTags() {
    const genres = [
      "Action",
      "Comedy",
      "Romance",
      "Fantasy",
      "Drama",
      "Sci-Fi",
      "Isekai",
      "Slice of Life",
    ];
    return genres.map((g) => ({ name: g, type: "general" }));
  }
}

// Register to the global Nexus registry
window.Nexus.register(MangaDex);
