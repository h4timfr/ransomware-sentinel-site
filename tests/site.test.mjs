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
import { basePath, build, loadConfig, platformVars } from "../scripts/build.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig();
const release = config.release;
// The primary host serves the site at "/"; the GitHub Pages mirror under its
// project path. Both builds are checked.
const PRIMARY = "https://ransomware-sentinel-site.vercel.app";
const MIRROR_PATH = new URL(`${config.mirrorUrl}/`).pathname;
const PRIVATE_REPO = /github\.com\/h4timfr\/ransomware-sentinel(?!-site)(?:[/."'#?\s]|$)/i;

let out;
let mirrorOut;
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

// Page text for claim checks. The homepage's "It does not claim" list names
// claims in order to deny them, so it is left out here and checked on its own.
function affirmativeText(content) {
  return content.replace(/<div class="doesnt">[\s\S]*?<\/div>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function decode(value) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

before(() => {
  out = mkdtempSync(join(tmpdir(), "sentinel-site-test-"));
  // Explicit, so a SITE_BASE_PATH in the developer's shell cannot change it.
  build({ outDir: out, quiet: true, sitePath: "/" });
  mirrorOut = mkdtempSync(join(tmpdir(), "sentinel-site-mirror-"));
  build({ outDir: mirrorOut, quiet: true, sitePath: MIRROR_PATH });
  htmlFiles = walk(out).filter((f) => f.endsWith(".html"));
  for (const f of htmlFiles) html.set(relative(out, f).split("\\").join("/"), readFileSync(f, "utf8"));
});

after(() => {
  rmSync(out, { recursive: true, force: true });
  rmSync(mirrorOut, { recursive: true, force: true });
});

describe("build", () => {
  test("produces every page, the download redirect, sitemap and robots.txt", () => {
    for (const page of ["index.html", "download/index.html", "docs/index.html", "faq/index.html",
      "privacy/index.html", "how-it-works/index.html", "404.html", "download/windows/index.html", "sitemap.xml", "robots.txt", ".nojekyll"]) {
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
        // GitHub hosts the releases and the repository; the privacy page links
        // the two hosts' privacy statements (GitHub and Vercel).
        assert.ok(["github.com", "docs.github.com", "vercel.com"].includes(host), `${page}: unexpected external host ${host}`);
        if (host === "vercel.com") assert.equal(page, "privacy/index.html", `${page}: links to vercel.com`);
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
    for (const path of ["", "how-it-works/", "download/", "docs/", "faq/", "privacy/"]) {
      assert.ok(sitemap.includes(`<loc>${config.siteUrl}/${path}</loc>`), `sitemap lacks /${path}`);
    }
    assert.ok(!sitemap.includes("404"), "the 404 page is in the sitemap");
    assert.ok(readFileSync(join(out, "robots.txt"), "utf8").includes(`Sitemap: ${config.siteUrl}/sitemap.xml`));
  });
});

describe("accessibility basics", () => {
  for (const page of ["index.html", "how-it-works/index.html", "download/index.html", "docs/index.html", "faq/index.html", "privacy/index.html", "404.html"]) {
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
      const text = affirmativeText(content);
      for (const pattern of banned) {
        const match = text.match(pattern);
        assert.ok(!match, `${page}: "${match && match[0]}"`);
      }
    }
  });

  test("states the key limitations where people decide to install", () => {
    const homeHtml = html.get("index.html");
    const doesnt = homeHtml.match(/<div class="doesnt">([\s\S]*?)<\/div>/);
    assert.ok(doesnt, "homepage has no list of what Sentinel does not claim");
    const denied = doesnt[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.match(denied, /^\s*It does not claim\b/, "the denial list must be headed as such");
    for (const claim of [/detect every ransomware family/i, /replace antivirus or EDR/i, /Kernel-level protection/i,
      /Cloud threat intelligence/i, /decrypt or recover files/i, /macOS or Linux support/i]) {
      assert.match(denied, claim, `the homepage does not deny ${claim}`);
    }
    const download = html.get("download/index.html").replace(/<[^>]+>/g, " ");
    assert.match(download, /not code-signed/i);
    assert.match(download, /Never turn off Microsoft Defender, SmartScreen or your antivirus/);
    const limits = html.get("how-it-works/index.html").replace(/<[^>]+>/g, " ");
    for (const limit of [/not a replacement for Microsoft Defender/, /No decryption or recovery/, /no kernel driver/,
      /Quarantine is containment, not isolation/, /No blocking, process termination or write prevention/]) {
      assert.match(limits, limit, `How it works does not state ${limit}`);
    }
  });

  test("screenshots from the Safe Demo are labelled as such", () => {
    // Every screenshot showing an alert, incident or demo state comes from the
    // Safe Demo. Each must be used, and every figure that shows it labelled.
    for (const name of ["13-activity", "16-incident-detail", "17-demo-complete", "18-diagnostics"]) {
      let used = 0;
      for (const [page, content] of html) {
        for (let at = content.indexOf(`shots/${name}-`); at !== -1; at = content.indexOf(`shots/${name}-`, at + 1)) {
          const start = content.lastIndexOf("<figure", at);
          assert.ok(start !== -1, `${page}: ${name} is not inside a figure`);
          const figure = content.slice(start, content.indexOf("</figure>", at));
          assert.match(figure, /Safe Demo/, `${page}: ${name} is not labelled as Safe Demo content`);
          used++;
        }
      }
      assert.ok(used > 0, `${name} is not shown on any page`);
    }
  });

  test("every screenshot is a numbered, captioned figure with descriptive alt text", () => {
    for (const [page, content] of html) {
      for (const img of tags(content, "img").filter((t) => attrs(t).src?.includes("shots/"))) {
        assert.ok(attrs(img).alt.length >= 20, `${page}: screenshot alt text too short: ${img}`);
        const at = content.indexOf(img);
        const figure = content.slice(content.lastIndexOf("<figure", at), content.indexOf("</figure>", at));
        assert.match(figure, /<figcaption\b[^>]*>[\s\S]*FIG\.\s/i, `${page}: screenshot without a numbered caption`);
      }
    }
  });

  test("states the supported platform exactly and claims no other", () => {
    const text = (p) => html.get(p).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.ok(text("download/index.html").includes(release.windows), "download page lacks the supported Windows versions");
    assert.ok(text("download/index.html").includes(`Tested on ${release.testedOn}`));
    assert.ok(text("docs/index.html").includes("Windows 10 (version 1809 or later) or Windows 11, 64-bit"));
    for (const [page] of html) {
      if (page.startsWith("download/windows")) continue;
      // macOS and Linux may only be mentioned to say there is no version for them.
      const content = html.get(page).replace(/<div class="doesnt">[\s\S]*?<\/div>/g, " ");
      const plain = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      for (const m of plain.matchAll(/[^.?!]*\b(macOS|Mac OS|OS X|Linux)\b[^.?!]*[.?!]?/gi)) {
        assert.match(m[0], /not available|no macOS (?:or Linux )?(?:version|download)|no Linux version|coming soon|Is there a macOS version\?|macOS or Linux\?/i,
          `${page}: "${m[0].trim()}"`);
        assert.doesNotMatch(m[0], /\b(?:supports?|runs on|works on|download(?:s)? for) (?:macOS|Mac|Linux)\b|\b(?:macOS|Linux) (?:version|release|support) is available\b/i,
          `${page}: "${m[0].trim()}"`);
      }
    }
  });

  test("macOS is shown as coming soon, with no download of any kind", () => {
    assert.equal(config.platforms?.macos?.status ?? "coming-soon", "coming-soon",
      "macOS may only be offered once a real macOS release exists (see platformVars)");
    for (const page of ["index.html", "download/index.html"]) {
      const content = html.get(page);
      const card = content.match(/<article class="[^"]*" data-platform="macos" data-status="([^"]+)"[\s\S]*?<\/article>/);
      assert.ok(card, `${page} has no macOS card`);
      assert.equal(card[1], "coming-soon");
      assert.match(card[0], /Coming soon/);
      assert.match(card[0], /not available in the current release/);
      assert.deepEqual(tags(card[0], "a"), [], `${page}: the macOS card must not link anywhere`);
      assert.doesNotMatch(card[0], /<button\b/, `${page}: the macOS card must not offer an action`);
    }
    for (const [page, content] of html) {
      for (const tag of tags(content, "a")) {
        const href = decode(attrs(tag).href || "");
        assert.ok(!/\.(dmg|pkg|app|zip|tar\.gz)(?:[#?]|$)/i.test(href), `${page}: links to a non-Windows package ${href}`);
        assert.ok(!/mac(os)?/i.test(href), `${page}: links to a macOS address ${href}`);
      }
    }
  });

  test("an available macOS platform requires real, public release facts", () => {
    const base = { ...config, platforms: { macos: { status: "available" } } };
    assert.throws(() => platformVars(base), /lacks version, downloadUrl, sha256, sizeBytes, requirements/);
    assert.throws(() => platformVars({ ...config, platforms: { macos: { status: "beta" } } }), /must be "available" or "coming-soon"/);
    assert.deepEqual(platformVars(config), { macosAvailable: false });
  });

  test("never claims kernel-level monitoring, EDR, automatic prevention, decryption or isolation", () => {
    const banned = [
      /(?<!no |not |without )\bkernel[- ](?:level|mode) (?:monitoring|protection|driver)/i,
      /(?<!no |not |without )\bkernel driver\b/i,
      /(?<!not (?:a replacement for )?(?:Microsoft Defender or )?an? )\bendpoint detection and response\b/i,
      /\b(?:is|as) an EDR\b/i,
      /\b(?:prevents|blocks|stops) ransomware\b/i,
      /\b(?:decrypts|recovers encrypted|restores encrypted)\b/i,
      /(?<!not )\bisolat(?:es|ed|ion)\b(?! of)/i,
      /\bguaranteed?\b(?! that every)(?!.{0,40}\bnot\b)/i,
      /\b(?:identifies|names) the (?:exact |responsible )?(?:program|process) (?:every time|always|with certainty)/i,
    ];
    for (const [page, content] of html) {
      const text = affirmativeText(content);
      for (const pattern of banned) {
        const match = text.match(pattern);
        assert.ok(!match, `${page}: "${match && text.slice(Math.max(0, match.index - 40), match.index + 60)}"`);
      }
    }
  });
});

describe("public artifact hygiene", () => {
  // The site, its repository and every published asset are public. Nothing
  // from a developer's machine, the private application repository or an
  // internal branch may appear in them.
  const LEAKS = [
    [/[A-Za-z]:[\\/]+Users[\\/]/i, "a Windows user-profile path"],
    [/(?:^|[\s"'`(=])\/(?:Users|home)\/[\w.-]+/, "a macOS or Linux home path"],
    [/\/mnt\/data\b/i, "a sandbox path"],
    [/\bAppData\b/i, "an AppData path (use %LOCALAPPDATA%)"],
    [/\blocalhost\b|\b127\.0\.0\.1\b|\[::1\]/i, "a local address"],
    [/\b(?:feature|distribution|hotfix|bugfix|wip)\/[\w.-]+/i, "an internal branch name"],
    [/\bSentinel(?:Site|Shots|Docs|ShotsDrive)\b/, "a capture working folder"],
    [/\b(?:build_release|capture_screenshots)\.py\b/, "a private repository script"],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/, "an IP address"],
    [/[\w.+-]+@(?!v\d)[\w-]+\.[a-z]{2,}/i, "an email address"],
  ];
  // Deliberate exceptions: the local preview server and its documented URL,
  // and GitHub Actions references (actions/checkout@v4 is not an email).
  const ALLOW = new Map([
    ["scripts/serve.mjs", ["a local address"]],
    ["README.md", ["a local address"]],
    ["tests/site.test.mjs", LEAKS.map(([, what]) => what)],
  ]);

  function textFiles() {
    const source = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts")), ...walk(join(ROOT, "tests")),
      ...walk(join(ROOT, "release-notes")), ...walk(join(ROOT, ".github")), join(ROOT, "site.config.json"),
      join(ROOT, "README.md"), join(ROOT, "package.json")].map((f) => [relative(ROOT, f).split("\\").join("/"), f]);
    const built = walk(out).map((f) => [`dist/${relative(out, f).split("\\").join("/")}`, f]);
    return [...source, ...built].filter(([, f]) => /\.(html|css|js|mjs|json|txt|xml|py|md|yml|svg|webmanifest)$/.test(f));
  }

  test("no local paths, addresses, branch names, emails or private names in the repository or output", () => {
    const problems = [];
    for (const [name, file] of textFiles()) {
      const text = readFileSync(file, "utf8");
      for (const [pattern, what] of LEAKS) {
        if (ALLOW.get(name)?.includes(what)) continue;
        const m = text.match(pattern);
        if (m) problems.push(`${name}: ${what}: "${text.slice(Math.max(0, m.index - 30), m.index + 50).replace(/\s+/g, " ")}"`);
      }
    }
    assert.deepEqual(problems, []);
  });

  test("no images carry text metadata or embedded paths", () => {
    for (const file of walk(out).filter((f) => /\.(png|webp|jpe?g|gif|ico)$/i.test(f))) {
      const bytes = readFileSync(file);
      const latin = bytes.toString("latin1");
      for (const chunk of ["tEXt", "iTXt", "zTXt", "eXIf", "EXIF", "XMP ", "<x:xmpmeta"]) {
        assert.ok(!latin.includes(chunk), `${relative(out, file)} contains a ${chunk.trim()} metadata block`);
      }
      assert.ok(!/[A-Za-z]:\\Users\\|AppData|localhost/i.test(latin), `${relative(out, file)} embeds a path or address`);
    }
  });

  test("publishes no documents, archives or executables", () => {
    const banned = /\.(pdf|pptx?|docx?|xlsx?|odt|rtf|zip|7z|rar|exe|msi|ps1|bat|py)$/i;
    assert.deepEqual(walk(out).filter((f) => banned.test(f)).map((f) => relative(out, f)), []);
    assert.deepEqual(walk(join(ROOT, "src")).filter((f) => banned.test(f)).map((f) => relative(ROOT, f)), []);
    for (const [page, content] of html) {
      for (const tag of tags(content, "a")) {
        const href = decode(attrs(tag).href || "");
        if (href === release.downloadUrl || href === release.checksumUrl) continue;
        assert.ok(!/\.(pdf|pptx?|docx?|xlsx?|zip|exe|msi)(?:[#?]|$)/i.test(href), `${page} links to a document or binary: ${href}`);
      }
    }
  });

  test("every published screenshot is referenced, and every referenced one exists", () => {
    const shotsDir = join(out, "assets", "img", "shots");
    const published = readdirSync(shotsDir).filter((f) => f.endsWith(".webp"));
    const all = [...html.values()].join("\n");
    for (const f of published) assert.ok(all.includes(`shots/${f}`), `${f} is published but never used`);
    for (const m of all.matchAll(/shots\/([\w-]+\.webp)/g)) assert.ok(published.includes(m[1]), `${m[1]} is referenced but missing`);
  });
});

describe("release facts", () => {
  test("the frozen v1.3.2 release facts are exact", () => {
    // v1.3.2 is published and frozen: these values describe the file on the
    // public release and must never drift while the site offers this tag.
    if (release.tag !== "v1.3.2") return;
    assert.equal(release.version, "1.3.2");
    assert.equal(release.installerFile, "RansomwareSentinel-Setup.exe");
    assert.equal(release.sha256, "318e10deb4c095d85d17a11bfd952d92df14dfb586f71b647d8a176b6d4d472f");
    assert.equal(release.sizeBytes, 34484774);
    assert.equal(release.signed, false);
    assert.equal(release.architecture, "64-bit (x64)");
    assert.equal(release.windows, "Windows 10 (version 1809 or later) or Windows 11, 64-bit");
    assert.equal(release.testedOn, "Windows 11");
    assert.equal(release.downloadUrl, `${config.publicRepoUrl}/releases/download/v1.3.2/RansomwareSentinel-Setup.exe`);
  });

  test("the release notes publish the same checksum and size as the site", () => {
    const notes = readFileSync(join(ROOT, "release-notes", `${release.tag}.md`), "utf8");
    assert.ok(notes.includes(release.sha256), `release notes do not list ${release.sha256}`);
    assert.ok(notes.includes(release.sizeBytes.toLocaleString("en-US")), `release notes do not list ${release.sizeBytes} bytes`);
    assert.match(notes, new RegExp(`Ransomware Sentinel ${release.version.replace(/\./g, "\\.")}`));
    assert.match(notes, /Not code-signed yet/);
  });

  test("the homepage and download page show the current version, size, checksum and signing state", () => {
    // The size is shown as Windows shows it (binary megabytes, labelled MB)
    // and, on the download page, as the exact byte count.
    const mb = `${(release.sizeBytes / 1024 / 1024).toFixed(1)} MB`;
    assert.equal(mb, "32.9 MB");
    const exact = `${release.sizeBytes.toLocaleString("en-US")} bytes`;
    const home = html.get("index.html");
    const download = html.get("download/index.html");
    for (const [name, page] of [["homepage", home], ["download page", download]]) {
      assert.ok(page.includes(`Ransomware Sentinel ${release.version}`), `${name} lacks the version`);
      assert.ok(page.includes(mb), `${name} lacks the size ${mb}`);
      assert.ok(release.signed || page.includes("Not code-signed yet"), `${name} does not say the installer is unsigned`);
    }
    // The checksum lives on the download page; the homepage leads there.
    assert.ok(download.includes(`<code id="sha256">${release.sha256}</code>`), "download page lacks the full checksum");
    assert.ok(download.includes(exact), `download page lacks the exact size ${exact}`);
    assert.ok(tags(home, "a").some((t) => attrs(t).href === "./download/"), "homepage does not lead to the download page");
    // The installer is linked directly only beside its checksum; other pages
    // send visitors to the download page. Any direct link names this tag.
    const assetLinks = (page) => tags(page, "a").map((t) => decode(attrs(t).href || "")).filter((h) => h.includes("/releases/download/"));
    assert.ok(assetLinks(download).includes(release.downloadUrl), "download page does not link the installer");
    for (const [page, content] of html) {
      for (const href of assetLinks(content)) assert.ok(href.includes(`/download/${release.tag}/`), `${page}: ${href} is not the ${release.tag} asset`);
    }
  });

  test("no stale checksum, installer size or release URL survives anywhere", () => {
    // Any SHA-256 the site or repository shows is the current one; any byte
    // count is the current installer's; any release URL names the current tag.
    const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts")), ...walk(join(ROOT, "release-notes")),
      join(ROOT, "README.md"), join(ROOT, "site.config.json"), ...walk(out)]
      .filter((f) => /\.(html|css|js|mjs|json|txt|xml|md)$/.test(f));
    const exact = release.sizeBytes.toLocaleString("en-US");
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/\b[0-9a-f]{64}\b/gi)) assert.equal(m[0].toLowerCase(), release.sha256, `${relative(ROOT, f)}: stale hash ${m[0]}`);
      for (const m of text.matchAll(/\b\d{2},\d{3},\d{3}(?= bytes)/g)) assert.equal(m[0], exact, `${relative(ROOT, f)}: stale size ${m[0]} bytes`);
      for (const m of text.matchAll(/\/releases\/(?:download|tag)\/(v\d+\.\d+\.\d+)/g)) assert.equal(m[1], release.tag, `${relative(ROOT, f)}: stale release URL ${m[0]}`);
    }
    assert.deepEqual(readdirSync(join(ROOT, "release-notes")), [`${release.tag}.md`], "release notes exist for an unpublished release");
  });
});

describe("hosting", () => {
  test("Vercel is the canonical host for canonical, social, sitemap and robots URLs", () => {
    assert.equal(config.siteUrl, PRIMARY);
    for (const [page, content] of html) {
      if (page.startsWith("download/windows")) continue;
      const canonical = content.match(/<link rel="canonical" href="([^"]+)">/);
      if (page === "404.html") assert.equal(canonical, null, "the 404 page must not declare a canonical URL");
      else {
        const path = page === "index.html" ? "" : page.replace(/index\.html$/, "");
        assert.equal(canonical?.[1], `${PRIMARY}/${path}`, `${page} canonical`);
        assert.ok(content.includes(`<meta property="og:url" content="${PRIMARY}/${path}">`), `${page} og:url`);
      }
      assert.ok(content.includes(`<meta property="og:image" content="${PRIMARY}/assets/img/og-image.png">`), `${page} og:image`);
    }
    const sitemap = readFileSync(join(out, "sitemap.xml"), "utf8");
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.length >= 6);
    for (const loc of locs) assert.ok(loc.startsWith(`${PRIMARY}/`), `sitemap entry ${loc}`);
    assert.equal(readFileSync(join(out, "robots.txt"), "utf8"), `User-agent: *\nAllow: /\n\nSitemap: ${PRIMARY}/sitemap.xml\n`);
  });

  test("the primary build never uses the mirror's project path as a site path", () => {
    // The GitHub repository and mirror URLs legitimately contain the same
    // name (github.com/h4timfr/ransomware-sentinel-site/...); a site path
    // starts the URL.
    const sitePathUse = new RegExp(`(?:["'(\\s=]|url\\()${MIRROR_PATH}`);
    for (const file of walk(out)) {
      if (!/\.(html|css|js|xml|txt|json|svg)$/.test(file)) continue;
      const m = readFileSync(file, "utf8").match(sitePathUse);
      assert.ok(!m, `${relative(out, file)} uses the mirror path: ${m && m[0]}`);
    }
  });

  test("the 404 page loads its stylesheet, script, icons and links from the host's root", () => {
    for (const [dir, base] of [[out, "/"], [mirrorOut, MIRROR_PATH]]) {
      const page = readFileSync(join(dir, "404.html"), "utf8");
      const refs = [...page.matchAll(/\s(?:href|src)="([^"#]+)"/g)].map((m) => m[1]).filter((r) => !/^https?:/.test(r));
      assert.ok(refs.length >= 8);
      for (const ref of refs) {
        assert.ok(ref.startsWith(base), `${base} 404 links ${ref}`);
        const target = ref.slice(base.length);
        const file = join(dir, target.endsWith("/") || target === "" ? join(target, "index.html") : target);
        assert.ok(existsSync(file), `${base} 404: ${ref} does not exist in the build`);
      }
      for (const asset of ["assets/css/site.css", "assets/js/site.js", "assets/img/favicon.svg"]) {
        assert.ok(page.includes(`"${base}${asset}"`), `${base} 404 does not load ${asset}`);
      }
    }
  });

  test("the mirror build differs from the primary build only in its 404 page", () => {
    const files = (dir) => walk(dir).map((f) => relative(dir, f).split("\\").join("/")).sort();
    assert.deepEqual(files(mirrorOut), files(out));
    for (const f of files(out)) {
      const same = readFileSync(join(out, f)).equals(readFileSync(join(mirrorOut, f)));
      assert.equal(same, f !== "404.html", `${f} ${same ? "should differ" : "differs"} between the builds`);
    }
  });

  test("legacy anchors still lead somewhere: /#how-it-works and the docs anchors that moved", () => {
    const home = html.get("index.html");
    const docs = html.get("docs/index.html");
    // Without JavaScript the old id still exists; with it, site.js forwards.
    assert.match(home, /<section [^>]*id="how-it-works"/);
    assert.match(home, /<a hidden data-legacy-anchor="how-it-works" href="\.\/how-it-works\/">/);
    assert.match(docs, /<section id="limitations">/);
    for (const [anchor, href] of [["limitations", "../how-it-works/#limitations"], ["scoring", "../how-it-works/#signals"],
      ["monitoring-model", "../how-it-works/#observe"], ["release", "../download/"]]) {
      assert.ok(docs.includes(`<a hidden data-legacy-anchor="${anchor}" href="${href}">`), `docs/#${anchor} is not forwarded`);
    }
    const js = readFileSync(join(ROOT, "src", "assets", "js", "site.js"), "utf8");
    assert.match(js, /a\[data-legacy-anchor\]/);
    assert.match(js, /location\.replace\(moved\.href\)/);
    // Navigation goes to the page itself, never to the old homepage anchor.
    for (const [page, content] of html) {
      for (const tag of tags(content, "a")) {
        const a = attrs(tag);
        if ("data-legacy-anchor" in a) continue;
        assert.ok(!/#how-it-works$/.test(a.href || ""), `${page} links to the legacy anchor: ${a.href}`);
      }
    }
  });

  test("links in the published release notes resolve on the current site", () => {
    const notes = readFileSync(join(ROOT, "release-notes", `${release.tag}.md`), "utf8");
    const links = [...notes.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => m[1])
      .filter((u) => u.startsWith(config.mirrorUrl) || u.startsWith(config.siteUrl));
    assert.ok(links.length >= 2);
    for (const url of links) {
      const u = new URL(url);
      const path = u.pathname.slice(u.pathname.startsWith(MIRROR_PATH) ? MIRROR_PATH.length : 1);
      const page = html.get(`${path}index.html`);
      assert.ok(page, `${url}: no such page`);
      if (u.hash) assert.match(page, new RegExp(`\\sid="${u.hash.slice(1)}"`), `${url}: no such anchor`);
    }
  });

  test("the Pages workflow builds with the mirror's base path, and bad base paths are refused", () => {
    const workflow = readFileSync(join(ROOT, ".github", "workflows", "site.yml"), "utf8");
    assert.match(workflow, /\n {8}env:\n {10}SITE_BASE_PATH: \/ransomware-sentinel-site\/\n/, "the Pages build must set SITE_BASE_PATH to the mirror's path");
    assert.equal(MIRROR_PATH, "/ransomware-sentinel-site/");
    assert.equal(basePath(""), "/");
    assert.equal(basePath(MIRROR_PATH), MIRROR_PATH);
    for (const bad of ["ransomware-sentinel-site", "/ransomware-sentinel-site", "https://example.org/", "/../"]) {
      assert.throws(() => basePath(bad), /SITE_BASE_PATH/, bad);
    }
  });

  test("Vercel serves the same content security policy as the pages, plus frame-ancestors", () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    const headers = Object.fromEntries(vercel.headers.find((h) => h.source === "/(.*)").headers.map((h) => [h.key, h.value]));
    const meta = html.get("index.html").match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    const asSet = (csp) => new Set(csp.split(";").map((d) => d.trim()).filter(Boolean));
    const header = asSet(headers["Content-Security-Policy"]);
    for (const directive of asSet(meta)) assert.ok(header.has(directive), `vercel.json CSP lacks "${directive}"`);
    assert.ok(header.has("frame-ancestors 'none'"));
    assert.equal(header.size, asSet(meta).size + 1, "vercel.json CSP must not loosen or add anything else");
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.ok(headers["Referrer-Policy"]);
    // Headers only: build and routing stay in the Vercel project settings.
    assert.deepEqual(Object.keys(vercel).sort(), ["$schema", "headers"]);
  });
});

describe("no redundancy", () => {
  test("each screenshot appears once on the whole site", () => {
    const counts = {};
    for (const content of html.values()) {
      for (const m of content.matchAll(/<img src="[^"]*shots\/([\w-]+?)-\d+\.webp"/g)) counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
    for (const [name, n] of Object.entries(counts)) assert.equal(n, 1, `${name} is shown ${n} times`);
  });

  test("no sentence of page copy is repeated on another page", () => {
    // Shared chrome (head, header, footer) and the shared platform cards are
    // components, not copy; everything else has one home and is linked to.
    const owner = new Map();
    const problems = [];
    for (const [page, content] of html) {
      if (page.startsWith("download/windows")) continue;
      const text = content.replace(/<head>[\s\S]*?<\/head>/, "").replace(/<header[\s\S]*?<\/header>/, "")
        .replace(/<footer[\s\S]*?<\/footer>/, "").replace(/<div class="platforms">[\s\S]*?<\/div>\s*<\/article>\s*(?:<\/div>)?/g, " ")
        .replace(/<article class="platform[\s\S]*?<\/article>/g, " ")
        // A block boundary ends a sentence even without punctuation (headings).
        .replace(/<\/(?:p|h[1-6]|li|dt|dd|td|th|summary|figcaption|div|section)>/g, "\n")
        .replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/[^\S\n]+/g, " ");
      for (const sentence of text.split(/(?<=[.?!])\s+|\n/).map((s) => s.trim()).filter((s) => s.length >= 50)) {
        if (owner.has(sentence) && owner.get(sentence) !== page) problems.push(`${owner.get(sentence)} and ${page}: "${sentence.slice(0, 90)}"`);
        else owner.set(sentence, page);
      }
    }
    assert.deepEqual(problems, []);
  });

  test("the full checksum is shown only on the download page", () => {
    for (const [page, content] of html) {
      if (page === "download/index.html" || page.startsWith("download/windows")) continue;
      assert.ok(!content.includes(release.sha256), `${page} repeats the checksum; link to the download page instead`);
    }
  });

  test("the signal points published on How it works add up to 100", () => {
    const page = html.get("how-it-works/index.html");
    const points = [...page.matchAll(/<td class="num">\+(\d+)<\/td>/g)].map((m) => Number(m[1]));
    assert.deepEqual(points, [25, 25, 20, 15, 15]);
  });

  test("the stated signal combinations follow from the points and the band thresholds", () => {
    const points = [25, 25, 20, 15, 15].sort((a, b) => b - a);
    const fewest = (threshold) => { let sum = 0; for (let n = 1; n <= points.length; n++) { sum += points[n - 1]; if (sum >= threshold) return n; } return Infinity; };
    const words = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five" };
    const band = (score) => (score >= 80 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW");
    const how = html.get("how-it-works/index.html").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.match(how, new RegExp(`At most ${points[0]}, which is ${band(points[0])}\\b`), "single-signal band is wrong");
    assert.match(how, new RegExp(`At least ${words[fewest(60)]} signals together`), "HIGH combination is wrong");
    assert.match(how, new RegExp(`At least ${words[fewest(80)]} signals together`), "CRITICAL combination is wrong");
    const home = html.get("index.html").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.match(home, new RegExp(`HIGH needs at least ${words[fewest(60)]} signals together and CRITICAL at least ${words[fewest(80)]}`));
    const faq = html.get("faq/index.html").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.match(faq, new RegExp(`takes at least ${words[fewest(80)]} signals at once`));
  });
});
