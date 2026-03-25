const fastify = require("fastify")({ logger: true });
const path = require("path");
const axios = require("axios");

// Register the static plugin
fastify.register(require("@fastify/static"), {
  root: path.join(__dirname, "app"),
  prefix: "/",
});

// Route to serve your specific app.html
fastify.get("/", async (request, reply) => {
  return reply.sendFile("app.html");
});

fastify.get("/proxy", async (request, reply) => {
  const { url } = request.query;

  if (!url) {
    return reply.code(400).send({ error: "URL is missing" });
  }

  try {
    const upstream = await axios({
      method: "get",
      url,
      responseType: "stream",
      timeout: 30000,
      headers: {
        ...request.headers, // forward ALL client headers
        host: undefined, // prevent host override
      },
      validateStatus: () => true, // allow all status codes
      maxRedirects: 5,
    });

    // Set upstream status (200, 206, 404, etc.)
    reply.code(upstream.status);

    // Forward ALL upstream headers except dangerous ones
    for (const [key, value] of Object.entries(upstream.headers)) {
      if (
        key.toLowerCase() === "transfer-encoding" ||
        key.toLowerCase() === "connection"
      ) {
        continue;
      }
      reply.header(key, value);
    }

    // Stream directly
    return reply.send(upstream.data);
  } catch (err) {
    console.error("Proxy Fetch Error:", err.message);
    return reply.code(500).send({ error: "Proxy failed" });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3003, host: "0.0.0.0" });
    console.log("Server is buzzing at http://localhost:3003");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
