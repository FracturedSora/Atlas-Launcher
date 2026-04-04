"use strict";

const engine = require("../engine");

module.exports = async function mangaRoutes(fastify) {
  fastify.get("/manga", async (request, reply) => {
    const { search, chapters, pages } = request.query;

    if (!search && !chapters && !pages) {
      return reply.status(400).send({
        ok: false,
        error: "Provide at least one query param: search, chapters, or pages",
      });
    }

    try {
      let resultsTree = {};
      let queryMeta = {};

      if (chapters && pages) {
        resultsTree = await engine.manga.pages(pages);
        queryMeta = { mangaId: chapters, chapterId: pages };
      }
      else if (chapters) {
        resultsTree = await engine.manga.chapters(chapters);
        queryMeta = { mangaId: chapters };
      }
      else {
        resultsTree = await engine.manga.search(search);
        queryMeta = { search };
      }

      // ── Total Calculation ───────────────────────────────────────────────────
      const total = Object.values(resultsTree).reduce((acc, list) => {
        return acc + (Array.isArray(list) ? list.length : 0);
      }, 0);

      return {
        ok: true,
        query: queryMeta,
        total,
        results: resultsTree,
      };

    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: "Internal engine error",
        detail: err.message,
      });
    }
  });
};
