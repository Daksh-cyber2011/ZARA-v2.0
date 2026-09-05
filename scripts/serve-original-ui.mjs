// Serves the ORIGINAL MYRAA frontend (extracted from the user-provided installer)
// on port 3100, proxying /api/* to the live backend on :3000 for A/B UI comparison.
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORIGINAL_DIST = "/home/z/my-project/myraa/ui_ref/dist";
const BACKEND = { host: "127.0.0.1", port: 3000 };

const app = express();
app.use(express.json());

// Proxy REST calls to the real backend; rewrite /api/config so the gate opens.
app.use("/api", (req, res) => {
  const options = {
    host: BACKEND.host,
    port: BACKEND.port,
    path: req.originalUrl,
    method: req.method,
    headers: { ...req.headers, host: `${BACKEND.host}:${BACKEND.port}` },
  };
  const upstream = http.request(options, (ur) => {
    const headers = { ...ur.headers };
    const isConfig = req.originalUrl.split("?")[0] === "/api/config";
    if (!isConfig) {
      res.writeHead(ur.statusCode || 502, headers);
      ur.pipe(res);
      return;
    }
    // Buffer the config response and flip hasApiKey so the UI renders the
    // main interface (UI comparison only — no key is ever stored).
    const chunks = [];
    ur.on("data", (c) => chunks.push(c));
    ur.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8") || "{}";
      delete headers["content-length"];
      res.writeHead(ur.statusCode || 502, headers);
      try {
        const parsed = JSON.parse(body);
        parsed.hasApiKey = true;
        res.end(JSON.stringify(parsed));
      } catch {
        res.end(body);
      }
    });
  });
  upstream.on("error", (e) => {
    res.status(502).json({ error: String(e) });
  });
  req.pipe(upstream);
});

app.use(express.static(ORIGINAL_DIST));
app.get("*", (_req, res) => {
  res.sendFile(path.join(ORIGINAL_DIST, "index.html"));
});

app.listen(3100, () => console.log("ORIGINAL UI on http://127.0.0.1:3100"));
