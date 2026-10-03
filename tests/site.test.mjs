// Website tests: npm test
//
// Builds the site into a temporary folder and checks the result as a visitor
// (and a reviewer) would: every link and asset resolves, every page meets the
// accessibility and security basics, the download points only at the public
// release, the version is consistent, and no claim the product can't back up
// has crept into the copy.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build, loadConfig } from "../scripts/build.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig();
const release = config.release;
const PRIVATE_REPO = /github\.com\/h4timfr\/ransomware-sentinel(?!-site)(?:[/."'#?\s]|$)/i;

let out;
let htmlFiles;
const html = new Map(); // dist-relative posix path -> content

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}

function attrs(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));
}

function tags(content, name) {
  return [...content.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);
}

function decode(value) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

before(() => {
  out = mkdtempSync(join(tmpdir(), "sentinel-site-test-"));
  build({ outDir: out, quiet: true });
  htmlFiles = walk(out).filter((f) => f.endsWith(".html"));
  for (const f of htmlFiles) html.set(relative(out, f).split("\\").join("/"), readFileSync(f, "utf8"));
});

after(() => rmSync(out, { recursive: true, force: true }));

describe("build", () => {
  test("produces every page, the download redirect, sitemap and robots.txt", () => {
    for (const page of ["index.html", "download/index.html", "docs/index.html", "faq/index.html",
      "privacy/index.html", "404.html", "download/windows/index.html", "sitemap.xml", "robots.txt", ".nojekyll"]) {
      assert.ok(existsSync(join(out, page)), `${page} missing`);
    }
  });

  test("leaves no template syntax or double-escaped entities", () => {
    for (const [page, content] of html) {
      assert.ok(!/\{\{|\}\}/.test(content), `${page} has unrendered template syntax`);
      assert.ok(!content.includes("&amp;amp;"), `${page} is double-escaped`);
      assert.ok(!content.includes("<x-shot"), `${page} has an unrendered screenshot`);
    }
  });
});

describe("links and assets", () => {
  test("every internal link, image, script and stylesheet resolves", () => {
    const problems = [];
    for (const [page, content] of html) {
      const refs = [...content.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => decode(m[1]));
      for (const m of content.matchAll(/\ssrcset="([^"]+)"/g)) {
        refs.push(...m[1].split(",").map((s) => s.trim().split(/\s+/)[0]));
      }
      for (const ref of refs) {
        if (/^(https?:|mailto:)/.test(ref)) continue;
        let [path, hash] = ref.split("#");
        let target;
        if (path.startsWith("/")) {
          const base = new URL(config.siteUrl + "/").pathname;
          assert.ok(path.startsWith(base), `${page}: absolute link ${ref} outside the site path`);
          target = path.slice(base.length);
        } else {
          target = path === "" ? page : posix.normalize(posix.join(posix.dirname(page), path));
        }
        if (target === "." || target === "" || target.endsWith("/")) target = posix.join(target, "index.html");
        const file = join(out, target);
        if (!existsSync(file) || (statSync(file).isDirectory() && !existsSync(join(file, "index.html")))) {
          problems.push(`${page}: ${ref} -> ${target} does not exist`);
          continue;
        }
        if (hash) {
          const doc = html.get(statSync(file).isDirectory() ? `${target}/index.html` : target);
          if (doc && !new RegExp(`\\sid="${hash}"`).test(doc)) problems.push(`${page}: ${ref} -> no element #${hash}`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  test("external links go only to GitHub, open safely and use HTTPS", () => {
    for (const [page, content] of html) {
      for (const tag of tags(content, "a")) {
        const href = decode(attrs(tag).href || "");
        if (!/^https?:/.test(href)) continue;
        assert.ok(href.startsWith("https://"), `${page}: insecure link ${href}`);
        const host = new URL(href).host;
        assert.ok(["github.com", "docs.github.com"].includes(host), `${page}: unexpected external host ${host}`);
        if (href !== release.downloadUrl) {
          assert.match(attrs(tag).rel || "", /noopener/, `${page}: ${href} lacks rel=noopener`);
        }
      }
    }
  });

  test("no page loads anything from another site", () => {
    for (const [page, content] of html) {
      for (const tag of [...tags(content, "script"), ...tags(content, "link"), ...tags(content, "img"), ...tags(content, "iframe")]) {
        const a = attrs(tag);
        const url = a.src || (a.rel === "canonical" ? "" : a.href) || "";
        assert.ok(!/^(https?:)?\/\//.test(url), `${page}: loads ${url} from another site`);
      }
    }
  });

  test("the sitemap and robots.txt use the configured site URL", () => {
    const sitemap = readFileSync(join(out, "sitemap.xml"), "utf8");
    for (const path of ["", "download/", "docs/", "faq/", "privacy/"]) {
      assert.ok(sitemap.includes(`<loc>${config.siteUrl}/${path}</loc>`), `sitemap lacks /${path}`);
    }
    assert.ok(!sitemap.includes("404"), "the 404 page is in the sitemap");
    assert.ok(readFileSync(join(out, "robots.txt"), "utf8").includes(`Sitemap: ${config.siteUrl}/sitemap.xml`));
  });
});

describe("accessibility basics", () => {
  for (const page of ["index.html", "download/index.html", "docs/index.html", "faq/index.html", "privacy/index.html", "404.html"]) {
    test(`${page}: language, title, one h1, skip link, labelled images`, () => {
      const content = html.get(page);
      assert.match(content, /<html lang="en">/);
      assert.match(content, /<title>[^<]{10,}<\/title>/);
      assert.match(content, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
      assert.equal((content.match(/<h1\b/g) || []).length, 1, "exactly one h1");
      assert.match(content, /<a class="skip-link" href="#main">/);
      assert.match(content, /<main id="main"/);
      for (const img of tags(content, "img")) {
        const a = attrs(img);
        assert.ok("alt" in a, `image without alt: ${img}`);
        assert.ok(a.width && a.height, `image without dimensions: ${img}`);
      }
      // Headings do not skip levels (h2 -> h4).
      const levels = [...content.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
      for (let i = 1; i < levels.length; i++) {
        assert.ok(levels[i] <= levels[i - 1] + 1, `heading jumps from h${levels[i - 1]} to h${levels[i]}`);
      }
    });
  }

  test("ids are unique on every page", () => {
    for (const [page, content] of html) {
      const ids = [...content.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], `${page} has duplicate ids`);
    }
  });
});

describe("security and privacy", () => {
  test("every page has a strict content security policy and no inline code", () => {
    for (const [page, content] of html) {
      const csp = content.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
      assert.ok(csp, `${page} has no CSP`);
      assert.match(csp[1], /default-src 'none'/);
      assert.ok(!csp[1].includes("unsafe-inline") && !csp[1].includes("unsafe-eval"), `${page} CSP allows inline code`);
      assert.ok(!/\sstyle="/.test(content), `${page} has an inline style attribute`);
      assert.ok(!/<style\b/.test(content), `${page} has an inline <style> block`);
      for (const script of tags(content, "script")) assert.ok(attrs(script).src, `${page} has an inline script`);
      assert.ok(!/\son[a-z]+="/i.test(content), `${page} has an inline event handler`);
    }
  });

  test("the script tracks nothing and talks to no server", () => {
    const js = readFileSync(join(ROOT, "src", "assets", "js", "site.js"), "utf8");
    for (const banned of ["fetch(", "XMLHttpRequest", "sendBeacon", "localStorage", "sessionStorage", "document.cookie",
      "indexedDB", "WebSocket", "navigator.userAgent", "gtag", "analytics"]) {
      assert.ok(!js.includes(banned), `site.js uses ${banned}`);
    }
  });

  test("no secrets, credentials or private repository addresses anywhere in the source or output", () => {
    const secret = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|xox[baprs]-|api[_-]?key\s*[:=]|password\s*[:=])/i;
    const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts")), ...walk(join(ROOT, "tests")),
      ...walk(join(ROOT, "release-notes")), ...walk(join(ROOT, ".github")), join(ROOT, "site.config.json"),
      join(ROOT, "README.md"), join(ROOT, "package.json"), ...walk(out)]
      .filter((f) => /\.(html|css|js|mjs|json|txt|xml|py|md|yml)$/.test(f));
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      assert.ok(!secret.test(text), `${f} looks like it contains a secret`);
      assert.ok(!PRIVATE_REPO.test(text), `${f} mentions the private source repository`);
      assert.ok(!/C:\\Users\\admin|\\Users\\admin\\/i.test(text), `${f} contains a local user path`);
    }
  });
});

describe("download and release", () => {
  test("download links point only at the public release of this version", () => {
    const publicReleases = `${config.publicRepoUrl}/releases/`;
    for (const url of [release.downloadUrl, release.checksumUrl, release.releaseNotesUrl]) {
      assert.ok(url.startsWith(publicReleases), `${url} is not a public release URL`);
      assert.ok(url.includes(release.tag), `${url} does not name ${release.tag}`);
      assert.ok(!PRIVATE_REPO.test(url), `${url} points at the private repository`);
    }
    assert.ok(release.downloadUrl.endsWith(`/${release.installerFile}`));
    assert.ok(release.checksumUrl.endsWith(`/${release.installerFile}.sha256`));
    assert.equal(release.tag, `v${release.version}`);
  });

  test("the stable /download/windows/ address forwards to the current installer", () => {
    const page = html.get("download/windows/index.html");
    assert.ok(page.includes(`content="0; url=${release.downloadUrl}"`));
    assert.ok(page.includes(`href="${release.downloadUrl}"`));
  });

  test("the download page shows the checksum and size exactly when they are known", () => {
    const page = html.get("download/index.html");
    if (release.sha256) {
      assert.match(release.sha256, /^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters");
      assert.ok(release.sizeBytes > 1_000_000, "installer size looks wrong");
      assert.ok(page.includes(`<code id="sha256">${release.sha256}</code>`));
      assert.ok(page.includes(`href="${release.downloadUrl}"`));
    } else {
      assert.ok(page.includes("not published yet"), "without a checksum the page must not offer a download");
      assert.ok(!page.includes(`href="${release.downloadUrl}"`));
    }
  });

  test("the published state says whether the installer is signed, and never claims it falsely", () => {
    const page = html.get("download/index.html");
    if (release.signed) assert.ok(page.includes(">Signed<"));
    else {
      assert.ok(page.includes("Not code-signed yet"));
      for (const [p, content] of html) assert.ok(!/\bis (code-)?signed\b/i.test(content), `${p} claims a signature`);
    }
  });
});

describe("content", () => {
  test("the current version appears on every page and no other version is called current", () => {
    for (const [page, content] of html) {
      if (page.startsWith("download/windows")) continue;
      assert.ok(content.includes(release.version), `${page} does not mention ${release.version}`);
      const versions = new Set([...content.matchAll(/\b(\d+\.\d+\.\d+)\b/g)].map((m) => m[1]));
      versions.delete(release.version);
      assert.deepEqual([...versions], [], `${page} names another version`);
    }
  });

  test("makes no claim the product cannot back up", () => {
    const banned = [/100\s*%/i, /detects? (all|every) ransomware/i, /impossible to bypass/i, /military[- ]grade/i,
      /unbreakable/i, /zero[- ]day/i, /trusted by/i, /award/i, /\bcertified\b/i, /enterprise[- ]grade/i,
      /guarantees? (that )?(your|you)/i, /we guarantee/i, /(?<!can it\s)\bstops? (all|every) ransomware/i, /AI[- ]powered|machine learning/i,
      /kernel[- ]level protection(?! and)/i,
      // Affirmative only: "is not a replacement for Microsoft Defender" is the point.
      /(?<!(?:not|n't)\s(?:a\s)?)\b(?:replaces|replacement for)\s(?:windows|microsoft)\sdefender/i];
    for (const [page, content] of html) {
      const text = content.replace(/<[^>]+>/g, " ");
      for (const pattern of banned) {
        const match = text.match(pattern);
        assert.ok(!match, `${page}: "${match && match[0]}"`);
      }
    }
  });

  test("states the key limitations where people decide to install", () => {
    const home = html.get("index.html").replace(/<[^>]+>/g, " ");
    const download = html.get("download/index.html").replace(/<[^>]+>/g, " ");
    assert.match(home, /Replace Microsoft Defender or antivirus/);
    assert.match(home, /Decrypt or recover files/);
    assert.match(home, /Guarantee that every ransomware attack is detected/);
    assert.match(download, /not code-signed/i);
    assert.match(download, /Never turn off Microsoft Defender, SmartScreen or your antivirus/);
  });

  test("screenshots from the Safe Demo are labelled as such", () => {
    for (const [page, content] of html) {
      for (const name of ["14-alerts", "16-incident-detail", "12-dashboard-incident"]) {
        const at = content.indexOf(`shots/${name}-`);
        if (at === -1) continue;
        const figure = content.slice(content.lastIndexOf("<figure", at), content.indexOf("</figure>", at));
        assert.match(figure, /Safe Demo/, `${page}: ${name} is not labelled as Safe Demo content`);
      }
    }
  });
});
