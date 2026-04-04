"use strict";

/**
 * Atlas Launcher — Extensions API Route
 * =======================================
 * GET /api/v1/extensions
 *   → List all currently loaded extensions with their capabilities
 *
 * POST /api/v1/extensions/reload
 *   → Hot-reload all extensions from disk (no launcher restart needed)
 */

const engine = require("../engine");

module.exports = async function extensionsRoutes(fastify) {
  // ── List all loaded extensions ─────────────────────────────────────────────
  fastify.get("/extensions", async () => {
    const list = engine.extensions();
    return {
      ok:    true,
      total: list.length,
      extensions: list,
    };
  });

  // ── Hot-reload extensions from disk ───────────────────────────────────────
  fastify.post("/extensions/reload", async () => {
    const list = engine.reload();
    return {
      ok:      true,
      message: "Extensions reloaded",
      total:   list.length,
      extensions: list,
    };
  });
};
