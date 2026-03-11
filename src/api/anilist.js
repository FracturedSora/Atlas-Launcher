const ANILIST_CLIENT_ID = process.env.ANILIST_CLIENT_ID || "nada";
const ANILIST_CLIENT_SECRET = process.env.ANILIST_CLIENT_SECRET || "nada";
const REDIRECT_URI = "http://localhost:3000/api/v1/anilist/callback";

module.exports = async function (fastify, opts) {
  fastify.get("/anilist/authorize", (req, res) => {
    try {
      const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${ANILIST_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
      res.json({ authUrl });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate authorization URL" });
    }
  });

  fastify.get("/anilist/callback", async (req, res) => {
    try {
      const { code } = req.query;
      if (!code)
        return res
          .status(400)
          .send(`<html><body>No code provided</body></html>`);
      const tokenResponse = await fetch(
        "https://anilist.co/api/v2/oauth/token",
        {
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
        },
      );
      const responseText = await tokenResponse.text();
      if (!tokenResponse.ok)
        return res
          .status(tokenResponse.status)
          .send(`<html><body>OAuth Error</body></html>`);
      const { access_token: accessToken } = JSON.parse(responseText);
      const userResponse = await fetch("https://graphql.anilist.co/", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          query: `query { Viewer { id name avatar { medium large } } }`,
        }),
      });
      const userData = JSON.parse(await userResponse.text());
      if (userData.errors)
        return res
          .status(400)
          .send(`<html><body>User fetch error</body></html>`);
      const user = userData.data.Viewer;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("oauth-success", {
          token: accessToken,
          username: user.name,
          avatar: user.avatar.medium,
          userId: user.id,
        });
      }
      res.send(`<!DOCTYPE html><html><head><title>Authorization Successful</title>
        <style>body{font-family:Arial;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}.container{text-align:center;background:white;padding:40px;border-radius:12px}</style>
        </head><body><div class="container"><h1>✅ Authorization Successful!</h1>
        <p>Welcome, ${user.name}!</p><p>Closing in 3 seconds...</p>
        </div><script>setTimeout(()=>window.close(),3000)</script></body></html>`);
    } catch (error) {
      res.status(500).send(`<html><body>Error: ${error.message}</body></html>`);
    }
  });
};
