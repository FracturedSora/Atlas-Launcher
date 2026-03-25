class WaifupicsNSFW {
  constructor() {
    this.baseUrl = "https://api.waifu.pics";
    this.name = "WaifuPics (18+)";
    this.type = "nsfw";
    this.logo = "https://waifu.pics/favicon.ico";
    this.categories = ["waifu", "neko", "trap", "blowjob"];

    // Internal cache to track seen IDs and store correct URLs
    this._urlCache = {};
    this.seenIds = new Set();
  }

  async search(query = "waifu", page = 1) {
    const category = this.categories.includes(query.toLowerCase())
      ? query.toLowerCase()
      : "waifu";

    // Clear session memory on a fresh search
    if (page === 1) {
      this.seenIds.clear();
      this._urlCache = {};
    }

    const url = `${this.baseUrl}/many/${this.type}/${category}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();

      // Filter out duplicates and map results
      const results = data.files
        .filter((fileUrl) => {
          const id = fileUrl.split("/").pop().split(".")[0];
          if (this.seenIds.has(id)) return false;
          this.seenIds.add(id);
          return true;
        })
        .map((fileUrl) => {
          const filename = fileUrl.split("/").pop();
          const id = filename.split(".")[0];

          // Store the REAL URL (including .gif or .mp4) in the cache
          this._urlCache[id] = fileUrl;

          return {
            id: id,
            thumb: fileUrl,
            url: fileUrl, // Pass full URL to loadGallery for extension checks
            tags: [category],
          };
        });

      return {
        results,
        hasNext: results.length > 0 && page < 10,
      };
    } catch (err) {
      console.error("WaifuPics NSFW Fetch failed:", err);
      return { results: [] };
    }
  }

  async getTrendingTags() {
    return this.categories.map((cat) => ({
      name: cat,
      count: "",
      type: "general",
    }));
  }

  async getPostDetails(id) {
    // Retrieve the exact URL from our cache so we don't guess the extension
    const foundUrl =
      this._urlCache[id] || `https://i.waifu.pics/nsfw/${id}.jpg`;

    // Detect if it's a video for the modal logic
    const isVideo = foundUrl.match(/\.(mp4|webm|mov)$/i) !== null;

    return {
      fullImage: foundUrl,
      tags: [
        { name: "waifu.pics", type: "copyright" },
        { name: "nsfw", type: "general" },
      ],
      comments: [],
      isVideo: isVideo,
    };
  }
}

window.Nexus.register(WaifupicsNSFW);
