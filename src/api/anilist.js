const path = require("path");
const os = require("os");
const fs = require("fs");

const ANILIST_CLIENT_ID = process.env.ANILIST_CLIENT_ID || "nada";
const ANILIST_CLIENT_SECRET = process.env.ANILIST_CLIENT_SECRET || "nada";
const REDIRECT_URI = "http://localhost:3000/api/v1/anilist/callback";

const DB_DIR = path.join(os.homedir(), "AtlasLauncher");
const DB_PATH = path.join(DB_DIR, "atlas.db");

function getDb() {
  const sqlite3 = require("sqlite3").verbose();
  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new sqlite3.Database(DB_PATH);
  // Return a promise that resolves with db only after table is guaranteed to exist
  return new Promise((resolve, reject) => {
    db.run(
      `
      CREATE TABLE IF NOT EXISTS accounts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        service    TEXT    NOT NULL DEFAULT 'anilist',
        username   TEXT    NOT NULL,
        avatar     TEXT,
        token      TEXT    NOT NULL,
        user_id    TEXT,
        created_at TEXT    DEFAULT (datetime('now')),
        updated_at TEXT    DEFAULT (datetime('now'))
      )
    `,
      (err) => {
        if (err) reject(err);
        else resolve(db);
      },
    );
  });
}

// Promisify sqlite3 get/run
function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    });
  });
}

module.exports = async function (fastify, opts) {
  // ── GET /api/v1/anilist/authorize ─────────────────────────────────────────
  fastify.get("/anilist/authorize", async (req, reply) => {
    try {
      const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${ANILIST_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
      return reply.send({ authUrl });
    } catch (e) {
      return reply
        .status(500)
        .send({ error: "Failed to generate authorization URL" });
    }
  });

  // ── GET /api/v1/anilist/callback ──────────────────────────────────────────
  fastify.get("/anilist/callback", async (req, reply) => {
    try {
      const { code } = req.query;
      if (!code)
        return reply
          .status(400)
          .type("text/html")
          .send(`<html><body>No code provided</body></html>`);

      // Exchange code for token
      const tokenRes = await fetch("https://anilist.co/api/v2/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: ANILIST_CLIENT_ID,
          client_secret: ANILIST_CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          code,
        }),
      });

      if (!tokenRes.ok)
        return reply
          .status(tokenRes.status)
          .type("text/html")
          .send(`<html><body>OAuth Error</body></html>`);

      const { access_token: token } = await tokenRes.json();

      // Fetch user info
      const userRes = await fetch("https://graphql.anilist.co/", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          query: `query { Viewer { id name avatar { medium large } } }`,
        }),
      });

      const { data, errors } = await userRes.json();
      if (errors)
        return reply
          .status(400)
          .type("text/html")
          .send(`<html><body>User fetch error</body></html>`);

      const { id: userId, name: username, avatar } = data.Viewer;
      const avatarUrl = avatar.medium;

      // ── Store in SQLite ────────────────────────────────────────────────────
      const db = await getDb();
      const existing = await dbGet(
        db,
        `SELECT id FROM accounts WHERE service = 'anilist'`,
      );

      if (existing) {
        await dbRun(
          db,
          `UPDATE accounts SET username = ?, avatar = ?, token = ?, user_id = ?, updated_at = datetime('now') WHERE service = 'anilist'`,
          [username, avatarUrl, token, String(userId)],
        );
      } else {
        await dbRun(
          db,
          `INSERT INTO accounts (service, username, avatar, token, user_id) VALUES ('anilist', ?, ?, ?, ?)`,
          [username, avatarUrl, token, String(userId)],
        );
      }
      db.close();

      // ── Notify Electron windows ────────────────────────────────────────────
      const { BrowserWindow } = require("electron");
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("oauth-success", {
          token,
          username,
          avatar: avatarUrl,
          userId,
        });
      });

      return reply.type("text/html").send(`<!DOCTYPE html>
        <html><head><title>Authorization Successful</title>
        <style>body{font-family:Arial;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}.container{text-align:center;background:white;padding:40px;border-radius:12px}</style>
        </head><body><div class="container">
          <h1>✅ Authorization Successful!</h1>
          <p>Welcome, ${username}!</p>
          <p>Closing in 3 seconds...</p>
        </div><script>setTimeout(()=>window.close(),3000)</script></body></html>`);
    } catch (e) {
      return reply
        .status(500)
        .type("text/html")
        .send(`<html><body>Error: ${e.message}</body></html>`);
    }
  });

  // ── GET /api/v1/anilist/me ────────────────────────────────────────────────
  fastify.get("/anilist/me", async (req, reply) => {
    try {
      const db = await getDb();
      const row = await dbGet(
        db,
        `SELECT username, avatar, token, user_id FROM accounts WHERE service = 'anilist'`,
      );
      db.close();
      if (!row) return reply.status(404).send({ error: "No account linked" });
      return reply.send({
        success: true,
        username: row.username,
        avatar: row.avatar,
        token: row.token,
        userId: row.user_id,
      });
    } catch (e) {
      return reply.status(500).send({ error: e.message });
    }
  });

  // ── DELETE /api/v1/anilist/unlink ─────────────────────────────────────────
  fastify.delete("/anilist/unlink", async (req, reply) => {
    try {
      const db = await getDb();
      await dbRun(db, `DELETE FROM accounts WHERE service = 'anilist'`);
      db.close();
      return reply.send({ success: true });
    } catch (e) {
      return reply.status(500).send({ error: e.message });
    }
  });
};
