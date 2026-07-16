/**
 * CJ DROPSHIPPING PROXY
 * A minimal reverse proxy that forwards every request to CJ Dropshipping's API.
 * Purpose: Cloudflare Workers share IP addresses with thousands of other apps,
 * and CJ blocks over-used IPs ("one ip limit 3 users"). Running this proxy on
 * a different host (Render) gives our traffic a different, less-congested IP.
 *
 * The Cloudflare Worker calls THIS server instead of CJ directly — same paths,
 * same methods, same bodies, just relayed through a different network.
 */

const http = require("http");
const https = require("https");

const CJ_HOST = "developers.cjdropshipping.com";
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // Health check for Render
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("CJ proxy is running");
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);

    const options = {
      hostname: CJ_HOST,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: CJ_HOST,
      },
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on("error", (err) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Proxy error", detail: err.message }));
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PORT, () => {
  console.log(`CJ proxy listening on port ${PORT}`);
});
