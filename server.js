/**
 * CJ DROPSHIPPING PROXY (with read caching)
 * Forwards every request to CJ's API from a dedicated host (avoids Cloudflare
 * shared-IP blocking). Read endpoints (token, product list, categories) are
 * cached in memory so the store loads fast; orders/payments NEVER cached.
 */

const http = require("http");
const https = require("https");

const CJ_HOST = "developers.cjdropshipping.com";
const PORT = process.env.PORT || 3000;

// endpoint prefix -> TTL ms. Anything not listed passes through uncached.
const CACHE_RULES = [
  ["/api2.0/v1/authentication/getAccessToken", 10 * 60 * 1000], // token reuse (10 min)
  ["/api2.0/v1/product/list", 10 * 60 * 1000], // catalog pages (10 min)
  ["/api2.0/v1/product/getCategory", 30 * 60 * 1000], // categories (30 min)
  ["/api2.0/v1/product/listCategory", 30 * 60 * 1000],
];

const cache = new Map(); // key -> { body, headers, status, expires }

function cacheTTL(path) {
  for (const [prefix, ttl] of CACHE_RULES) if (path.startsWith(prefix)) return ttl;
  return 0;
}

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("CJ proxy is running");
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const ttl = cacheTTL(req.url);
    const key = req.method + " " + req.url + " " + body.toString("utf8");

    if (ttl > 0) {
      const hit = cache.get(key);
      if (hit && hit.expires > Date.now()) {
        res.writeHead(hit.status, { ...hit.headers, "X-Cache": "HIT" });
        res.end(hit.body);
        return;
      }
      if (cache.size > 500) cache.clear(); // crude but bounded
    }

    const options = {
      hostname: CJ_HOST,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: CJ_HOST },
    };

    const proxyReq = https.request(options, (proxyRes) => {
      if (ttl > 0) {
        const bufs = [];
        proxyRes.on("data", (c) => bufs.push(c));
        proxyRes.on("end", () => {
          const buf = Buffer.concat(bufs);
          const hs = { ...proxyRes.headers };
          delete hs["content-length"];
          delete hs["transfer-encoding"];
          // only cache successful JSON responses (result === true)
          try {
            const parsed = JSON.parse(buf.toString("utf8"));
            if (parsed && parsed.result === true) {
              cache.set(key, { body: buf, headers: hs, status: proxyRes.statusCode, expires: Date.now() + ttl });
            }
          } catch (e) { /* not JSON — don't cache */ }
          res.writeHead(proxyRes.statusCode, { ...hs, "X-Cache": "MISS" });
          res.end(buf);
        });
      } else {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
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
  console.log(`CJ proxy listening on port ${PORT} (cache ON)`);
});
