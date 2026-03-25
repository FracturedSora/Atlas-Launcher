// ── Extension Loader ─────────────────────────────────────────────────────────
// Scans src/extensions/*.js and loads each as a provider.
// Extensions export: { id, name, search, findEpisodes, findEpisodeServer }

const fs   = require("fs");
const path = require("path");

const EXT_DIR    = path.join(__dirname, "src", "extensions");
const extensions = new Map(); // id → extension module

function loadExtensions() {
  if (!fs.existsSync(EXT_DIR)) { fs.mkdirSync(EXT_DIR, { recursive: true }); return; }
  const files = fs.readdirSync(EXT_DIR).filter(f => f.endsWith(".js"));
  for (const file of files) {
    try {
      const ext = require(path.join(EXT_DIR, file));
      if (ext.id) {
        extensions.set(ext.id, ext);
        console.log(`[extensions] Loaded: ${ext.name} (${ext.id})`);
      }
    } catch (e) {
      console.error(`[extensions] Failed to load ${file}:`, e.message);
    }
  }
}

function getExtension(id) { return extensions.get(id) || null; }
function listExtensions() { return [...extensions.values()].map(e => ({ id: e.id, name: e.name, url: e.url, logo: e.logo, supportsDub: e.supportsDub, episodeServers: e.episodeServers })); }

module.exports = { loadExtensions, getExtension, listExtensions };
