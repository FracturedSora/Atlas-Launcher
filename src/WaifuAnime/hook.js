// src/WaifuAnime/hook.js
// ─────────────────────────────────────────────────────────────────────────────
// Manages the WaifuAnime server as a forked child process.
// Drop this file into src/WaifuAnime/ alongside server.js.
// ─────────────────────────────────────────────────────────────────────────────

const { fork }  = require("child_process");
const path      = require("path");

const WAIFU_PORT = process.env.WAIFU_PORT || 3002;

let proc = null;

/**
 * Forks src/WaifuAnime/server.js and pipes its stdio to the parent console.
 * Returns immediately — does NOT block app startup.
 */
function start() {
  if (proc && !proc.killed) return; // already running

  const serverPath = path.join(__dirname, "server.js");

  proc = fork(serverPath, [], {
    cwd:   __dirname,
    env:   { ...process.env, PORT: String(WAIFU_PORT) },
    stdio: "pipe",
  });

  proc.stdout?.on("data", d => console.log("[WaifuAnime]", d.toString().trim()));
  proc.stderr?.on("data", d => console.error("[WaifuAnime]", d.toString().trim()));

  proc.on("error",  e    => console.error("[WaifuAnime] Process error:", e.message));
  proc.on("exit",  (code, sig) => {
    console.log(`[WaifuAnime] Exited — code=${code} signal=${sig}`);
    proc = null;
  });

  console.log(`[WaifuAnime] Server started on port ${WAIFU_PORT} (pid ${proc.pid})`);
}

/** Gracefully kills the child process. */
function stop() {
  if (!proc) return;
  try { proc.kill(); } catch (_) {}
  proc = null;
  console.log("[WaifuAnime] Server stopped.");
}

module.exports = { start, stop };
