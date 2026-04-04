// src/WaifuManga/hook.js
// ─────────────────────────────────────────────────────────────────────────────
// Manages the WaifuManga server as a forked child process.
// Drop this file into src/WaifuManga/ alongside server.js.
// ─────────────────────────────────────────────────────────────────────────────

const { fork }  = require("child_process");
const path      = require("path");

const WAIFU_PORT = process.env.WAIFU_PORT || 3001;

let proc = null;

/**
 * Forks src/WaifuManga/server.js and pipes its stdio to the parent console.
 * Returns immediately — does NOT block app startup.
 */
 function start() {
   if (proc && !proc.killed) return;

   // 1. DETERMINE THE CORRECT PATH
   // In an EXE, we use process.argv[0] (the node binary/exe itself)
   // In dev, we use the actual server.js file
   const isExe = process.pkg ? true : false;

   const serverPath = isExe
     ? path.join(__dirname, "server.js") // pkg maps this internally
     : path.join(__dirname, "server.js");

   // 2. FORK LOGIC
   // If it's an EXE, some bundlers require you to fork the EXE itself
   // with a specific flag, but usually, pointing to the internal path works
   proc = fork(serverPath, [], {
     cwd: process.cwd(), // Use current working directory of the user
     env: { ...process.env, PORT: String(WAIFU_PORT) },
     stdio: "pipe",
   });

   proc.stdout?.on("data", d => console.log("[WaifuManga]", d.toString().trim()));
   proc.stderr?.on("data", d => console.error("[WaifuManga]", d.toString().trim()));

   proc.on("error", e => {
     // If it still fails, it's because the EXE didn't bundle server.js
     console.error("[WaifuManga] Process error:", e.message);
     if (e.code === 'ENOENT') {
        console.error("HELP: Make sure server.js is included in your build assets!");
     }
   });

   proc.on("exit", (code, sig) => {
     console.log(`[WaifuManga] Exited — code=${code} signal=${sig}`);
     proc = null;
   });

   console.log(`[WaifuManga] Server started on port ${WAIFU_PORT} (pid ${proc.pid})`);
 }

/** Gracefully kills the child process. */
function stop() {
  if (!proc) return;
  try { proc.kill(); } catch (_) {}
  proc = null;
  console.log("[WaifuManga] Server stopped.");
}

module.exports = { start, stop };
