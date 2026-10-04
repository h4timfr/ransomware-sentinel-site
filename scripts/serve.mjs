// Local preview of dist/ at the same path GitHub Pages serves it from
// (the path part of siteUrl), so relative links are tested as deployed.
//
//   npm run build && npm run serve      -> http://localhost:4173/<path>/

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { loadConfig } from "./build.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT || 4173);
const BASE = new URL(loadConfig().siteUrl + "/").pathname;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8", ".json": "application/json",
};

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/") { res.writeHead(302, { Location: BASE }); return res.end(); }
  if (!url.pathname.startsWith(BASE)) return notFound(res);
  const rel = normalize(decodeURIComponent(url.pathname.slice(BASE.length))).replace(/^(\.\.[\\/])+/, "");
  let file = join(DIST, rel);
  if (!file.startsWith(DIST)) return notFound(res);
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!url.pathname.endsWith("/")) { res.writeHead(301, { Location: url.pathname + "/" }); return res.end(); }
    file = join(file, "index.html");
  }
  if (!existsSync(file)) return notFound(res);
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`Serving dist/ at http://localhost:${PORT}${BASE}`));

function notFound(res) {
  res.writeHead(404, { "Content-Type": TYPES[".html"] });
  res.end(readFileSync(join(DIST, "404.html")));
}
