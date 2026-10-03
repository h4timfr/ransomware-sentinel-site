// Static site build for the Ransomware Sentinel website. No dependencies.
//
//   node scripts/build.mjs            -> dist/
//
// Every page in src/pages is an HTML fragment with a small JSON header. It is
// wrapped in src/partials/layout.html, and every release fact (version,
// download URL, checksum, size...) comes from site.config.json, so a new
// release changes one file. Links between pages are written relative
// ({{root}}), so the site works at a GitHub Pages project path or at the root
// of a custom domain without changes.

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");

export function loadConfig(path = join(ROOT, "site.config.json")) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.siteUrl = config.siteUrl.replace(/\/+$/, "");
  return config;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

export function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatSize(bytes) {
  if (!bytes) return "";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parsePage(file) {
  const raw = readFileSync(file, "utf8");
  const match = raw.match(/^<!--page\s*([\s\S]*?)-->\s*/);
  if (!match) throw new Error(`${file}: missing <!--page {...} --> header`);
  return { meta: JSON.parse(match[1]), body: raw.slice(match[0].length) };
}

// {{#if key}} ... {{else}} ... {{/if}} (not nested), then {{key}}.
function render(template, vars) {
  let out = template.replace(/\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
    (_, key, yes, no = "") => (vars[key] ? yes : no));
  out = out.replace(/\{\{(\{?)([\w.]+)\}?\}\}/g, (whole, raw, key) => {
    if (!(key in vars)) throw new Error(`Unknown template variable {{${key}}}`);
    return raw ? String(vars[key]) : escapeHtml(vars[key]);
  });
  return out;
}

// <x-shot name="08-dashboard" alt="..." sizes="..." loading="eager"></x-shot>
function renderShots(html, shots, root, file) {
  return html.replace(/<x-shot\s+([^>]*)><\/x-shot>/g, (_, attrs) => {
    const a = Object.fromEntries([...attrs.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const shot = shots[a.name];
    if (!shot) throw new Error(`${file}: no optimized screenshot named "${a.name}"`);
    if (!a.alt) throw new Error(`${file}: screenshot "${a.name}" has no alt text`);
    const src = (w) => `${root}assets/img/shots/${a.name}-${w}.webp`;
    const widths = shot.widths;
    const largest = widths[widths.length - 1];
    const height = Math.round((largest * shot.height) / shot.width);
    const eager = a.loading === "eager";
    return `<img src="${src(widths[1] ?? largest)}" srcset="${widths.map((w) => `${src(w)} ${w}w`).join(", ")}" ` +
      `sizes="${a.sizes || "(min-width: 1200px) 1100px, 100vw"}" width="${largest}" height="${height}" ` +
      `alt="${a.alt}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
  });
}

function relativeRoot(outPath) {
  const depth = outPath.split("/").length - 1;
  return depth === 0 ? "./" : "../".repeat(depth);
}

export function build({ config = loadConfig(), outDir = DIST, quiet = false } = {}) {
  const release = config.release;
  const layout = readFileSync(join(SRC, "partials", "layout.html"), "utf8");
  const shots = JSON.parse(readFileSync(join(SRC, "assets", "img", "shots", "manifest.json"), "utf8"));
  const sitePath = new URL(config.siteUrl + "/").pathname; // "/ransomware-sentinel-site/" or "/"

  const base = {
    siteName: config.siteName,
    siteUrl: config.siteUrl,
    publicRepoUrl: config.publicRepoUrl,
    version: release.version,
    tag: release.tag,
    releaseDate: formatDate(release.date),
    releaseDateIso: release.date,
    installerFile: release.installerFile,
    downloadUrl: release.downloadUrl,
    checksumUrl: release.checksumUrl,
    releaseNotesUrl: release.releaseNotesUrl,
    sha256: release.sha256,
    size: formatSize(release.sizeBytes),
    signed: release.signed,
    architecture: release.architecture,
    windows: release.windows,
    testedOn: release.testedOn,
    year: new Date().getUTCFullYear(),
  };

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(join(SRC, "assets"), join(outDir, "assets"), { recursive: true });
  rmSync(join(outDir, "assets", "img", "shots", "manifest.json"));

  const pages = [];
  for (const name of readdirSync(join(SRC, "pages")).filter((f) => f.endsWith(".html")).sort()) {
    const file = join(SRC, "pages", name);
    const { meta, body } = parsePage(file);
    const outPath = meta.path === "404" ? "404.html" : `${meta.path}index.html`;
    // 404.html is served at any depth, so it links from the site's absolute path.
    const root = meta.path === "404" ? sitePath : relativeRoot(outPath);
    const canonical = meta.path === "404" ? "" : `${config.siteUrl}/${meta.path}`;
    const vars = {
      ...base,
      root,
      canonical,
      title: render(meta.title, base),
      description: render(meta.description, base),
      ogImage: `${config.siteUrl}/assets/img/og-image.png`,
      robots: meta.path === "404" ? "noindex" : "index, follow",
      bodyClass: meta.bodyClass || "",
    };
    for (const nav of ["home", "product", "how", "docs", "download", "faq"]) {
      vars[`nav_${nav}`] = meta.nav === nav ? "page" : "false";
    }
    let content = render(body, vars);
    content = renderShots(content, shots, root, name);
    let html = render(layout, { ...vars, content });
    html = html.replace(/ aria-current="false"/g, "");
    if (/\{\{|\}\}/.test(html)) throw new Error(`${name}: unrendered template syntax remains`);
    const target = join(outDir, outPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, html);
    pages.push({ path: meta.path, outPath, sitemap: meta.sitemap !== false && meta.path !== "404" });
  }

  // A stable address that always leads to the current installer.
  const redirect = render(readFileSync(join(SRC, "partials", "download-redirect.html"), "utf8"), {
    ...base, root: "../../",
  });
  mkdirSync(join(outDir, "download", "windows"), { recursive: true });
  writeFileSync(join(outDir, "download", "windows", "index.html"), redirect);

  const urls = pages.filter((p) => p.sitemap)
    .map((p) => `  <url><loc>${config.siteUrl}/${p.path}</loc><lastmod>${release.date}</lastmod></url>`);
  writeFileSync(join(outDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);
  writeFileSync(join(outDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
  // GitHub Pages: serve files as they are (no Jekyll processing).
  writeFileSync(join(outDir, ".nojekyll"), "");
  if (config.customDomain) writeFileSync(join(outDir, "CNAME"), `${config.customDomain}\n`);

  const files = [];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : files.push(join(dir, e.name)));
  walk(outDir);
  const digest = createHash("sha256");
  for (const f of files.sort()) digest.update(relative(outDir, f)).update(readFileSync(f));
  if (!quiet) console.log(`Built ${pages.length} pages, ${files.length} files into ${relative(ROOT, outDir) || "."} (${digest.digest("hex").slice(0, 12)})`);
  return { pages, files };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (!existsSync(join(SRC, "assets", "img", "shots", "manifest.json"))) {
      throw new Error("Screenshots are not optimized yet: run scripts/optimize-images.py first.");
    }
    build();
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
    process.exit(1);
  }
}
