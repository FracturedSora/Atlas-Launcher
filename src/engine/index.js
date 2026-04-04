"use strict";
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const { transform } = require("sucrase");

class TitanEngine {
    constructor() {
        this.anime = {};
        this.baseDir = __dirname;
        this.load();
    }

    load() {
        const animePath = path.join(this.baseDir, "extensions-anime");
        if (!fs.existsSync(animePath)) return;

        fs.readdirSync(animePath).forEach(file => {
            if (!file.endsWith(".js") && !file.endsWith(".ts")) return;
            const id = file.split(".")[0].toLowerCase();
            try {
                const raw = fs.readFileSync(path.join(animePath, file), "utf-8");
                const js = transform(raw, { transforms: ["typescript", "imports"] }).code;
                const mod = { exports: {} };
                const context = vm.createContext({
                    module: mod, exports: mod.exports, Buffer, console,
                    fetch: require("cross-fetch"),
                    LoadDoc: require("cheerio").load,
                    URL, JSON, Math, Promise, setTimeout,
                    require: (n) => (n === "cheerio" ? require("cheerio") : require("cross-fetch"))
                });
                new vm.Script(js).runInContext(context);
                const provider = mod.exports.default || mod.exports;
                this.anime[id] = typeof provider === 'function' ? new provider() : provider;
                console.log(`[Titan] ✓ Loaded: ${id}`);
            } catch (e) { console.error(`[Titan] ✗ Error loading ${id}:`, e.message); }
        });
    }

    // Direct call to a specific scraper
    async call(id, method, ...args) {
        const ext = this.anime[id];
        if (!ext || typeof ext[method] !== "function") return null;
        const result = await ext[method](...args);
        console.log(`[Titan] ${id}.${method}() returned ${Array.isArray(result) ? result.length : '1'} items.`);
        return result;
    }

    // Call all scrapers (Search)
    async callAll(method, ...args) {
        const results = {};
        for (const id in this.anime) {
            results[id] = await this.call(id, method, ...args);
        }
        return results;
    }
}

module.exports = new TitanEngine();
