class Waifupics {
  constructor() {
    this.baseUrl = "https://api.waifu.pics";
    this.name = "WaifuPics";
    this.type = "sfw"; // Change to "nsfw" if you intend to use their NSFW endpoints
    this.logo = "https://waifu.pics/favicon.ico";

    // Available categories for Waifu.pics SFW
    this.categories = [
      "waifu",
      "neko",
      "shinobu",
      "megumin",
      "bully",
      "cuddle",
      "cry",
      "hug",
      "awoo",
      "kiss",
      "lick",
      "pat",
      "smug",
      "bonk",
      "yeet",
      "blush",
      "smile",
      "wave",
      "highfive",
      "handhold",
      "nom",
      "bite",
      "glomp",
      "slap",
      "kill",
      "kick",
      "happy",
      "wink",
      "poke",
      "dance",
      "cringe",
    ];
  }

  /**
   * Waifu.pics gives random images by category.
   * We treat the 'query' as the category name.
   */

  // Add a Set to your constructor to track seen IDs
  // this.seenIds = new Set();

  async search(query = "waifu", page = 1) {
    const category = this.categories.includes(query.toLowerCase())
      ? query.toLowerCase()
      : "waifu";

    // If it's a new search (Page 1), clear the seen list
    if (page === 1) this.seenIds = new Set();

    const url = `${this.baseUrl}/many/${this.type}/${category}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();

      // Filter out duplicates before mapping
      const uniqueFiles = data.files.filter((fileUrl) => {
        const id = fileUrl.split("/").pop().split(".")[0];
        if (this.seenIds.has(id)) return false;
        this.seenIds.add(id);
        return true;
      });

      const results = uniqueFiles.map((url) => {
        const filename = url.split("/").pop();
        const id = filename.split(".")[0];

        return {
          id: id,
          thumb: url,
          url: url,
          extension: filename.split(".").pop(),
          tags: [category],
        };
      });

      return {
        results,
        // Since it's random, we can technically go forever,
        // but we'll stop if the API returns no NEW images.
        hasNext: results.length > 0,
      };
    } catch (err) {
      console.error("WaifuPics Fetch failed:", err);
      return { results: [] };
    }
  }

  /**
   * Maps categories to the sidebar trending list
   */
  async getTrendingTags() {
    // Returning categories as trending tags
    return this.categories.slice(0, 25).map((cat) => ({
      name: cat,
      count: "API",
      type: "general",
    }));
  }

  /**
   * Waifu.pics images are direct links, so details are simplified
   */
  async getPostDetails(id) {
    // Use the cached URL if we have it, otherwise fallback to JPG
    const foundUrl =
      this._urlCache && this._urlCache[id]
        ? this._urlCache[id]
        : `https://i.waifu.pics/${id}.jpg`;

    const isVideo = foundUrl.match(/\.(mp4|webm|mov)$/i) !== null;

    return {
      fullImage: foundUrl,
      tags: [{ name: "waifu.pics", type: "copyright" }],
      comments: [],
      isVideo: isVideo,
    };
  }
}

// Register to the global Nexus registry
window.Nexus.register(Waifupics);
