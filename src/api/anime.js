"use strict";
const engine = require("../engine");

module.exports = async function(fastify) {
    fastify.get("/anime", async (req, reply) => {
        const { search, episodes, sources, url } = req.query;

        try {
            // 1. RAW URL (The Scraper MAX way)
            if (url) {
                const domain = new URL(url).hostname.replace("www.", "").split(".")[0];
                const res = await engine.call(domain, "resolveUrl", url);
                return { ok: true, results: { [domain]: res } };
            }

            // 2. DETECT INTENT (Smart Routing)
            // If episodes or sources has 3 parts (e.g., 6wbOWi/sub/1), it's a VIDEO request.
            const targetId = sources || episodes;
            if (targetId && targetId.split("/").length === 3) {
                const [id, subOrDub, num] = targetId.split("/");
                const providerId = "anicrush"; // We can detect this later if you have more providers

                const data = await engine.call(providerId, "findEpisodeServer", {
                    id: `${id}/${subOrDub}`,
                    number: parseInt(num)
                }, req.query.server || "Southcloud-1");

                return { ok: true, results: { [providerId]: data } };
            }

            // 3. EPISODE LIST (ID has 2 parts: 6wbOWi/sub)
            if (episodes) {
                return { ok: true, results: await engine.callAll("findEpisodes", episodes) };
            }

            // 4. SEARCH
            if (search) {
                const results = await engine.callAll("search", search);
                return { ok: true, total: Object.values(results).flat().length, results };
            }

            return reply.status(400).send({ ok: false, error: "No valid query provided." });

        } catch (err) {
            return { ok: false, error: err.message };
        }
    });
};
