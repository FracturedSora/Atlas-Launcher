const { fork } = require("child_process");
const path = require("path");

const WAIFU_PORT = process.env.WAIFU_PORT || 3002;
let proc = null;

function start() {
  if (proc && !proc.killed) return;

  // 1. PATH RESOLUTION
  // We check if we are running inside an Electron ASAR environment
  let serverPath = path.join(__dirname, "server.js");

  // If the path contains 'app.asar', it means we are in the production EXE.
  // We need to redirect to 'app.asar.unpacked' so the fork can actually access the files.
  if (serverPath.includes('app.asar') && !serverPath.includes('app.asar.unpacked')) {
    serverPath = serverPath.replace('app.asar', 'app.asar.unpacked');
  }

  // 2. FORK LOGIC
  // We explicitly point to the Electron binary to ensure the child process
  // has the same environment/Node version as the parent.
  proc = fork(serverPath, [], {
    cwd: path.dirname(serverPath), // Set CWD to the actual folder containing the server
    env: {
      ...process.env,
      PORT: String(WAIFU_PORT),
      ELECTRON_RUN_AS_NODE: "1" // Tells Electron to act like a normal Node.js process
    },
    stdio: "pipe",
  });

  proc.stdout?.on("data", d => console.log("[WaifuAnime]", d.toString().trim()));
  proc.stderr?.on("data", d => console.error("[WaifuAnime]", d.toString().trim()));

  proc.on("error", e => {
    console.error("[WaifuAnime] Process error:", e.message);
    if (e.code === 'ENOENT') {
       console.error(`[WaifuAnime] FAILED TO FIND: ${serverPath}`);
    }
  });

  proc.on("exit", (code, sig) => {
    console.log(`[WaifuAnime] Exited — code=${code} signal=${sig}`);
    proc = null;
  });

  if (proc.pid) {
    console.log(`[WaifuAnime] Server started on port ${WAIFU_PORT} (pid ${proc.pid})`);
  }
}

/** Gracefully kills the child process. */
function stop() {
  if (!proc) return;
  try { proc.kill(); } catch (_) {}
  proc = null;
  console.log("[WaifuAnime] Server stopped.");
}

module.exports = { start, stop };
