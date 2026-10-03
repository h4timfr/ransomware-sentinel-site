# Ransomware Sentinel: website and downloads

The public website for [Ransomware Sentinel](https://h4timfr.github.io/ransomware-sentinel-site/),
a local ransomware detection app for Windows, and the public home of its
installer releases.

Looking for the app? **[Download it here](https://h4timfr.github.io/ransomware-sentinel-site/download/)**.
Nothing in this repository needs to be built or run to use Ransomware Sentinel.

This repository is for maintaining the site. The application's source code
lives in a separate, private repository. This one contains only the static
website, the release notes and the published installers (as GitHub release
assets).

## How it fits together

```
private application repository             public: this repository
──────────────────────────────             ───────────────────────────────────
release tag (v1.3.0)                       GitHub release v1.3.0
  └─ scripts/build_release.py  ──upload──►   RansomwareSentinel-Setup.exe
       clean worktree of the tag              RansomwareSentinel-Setup.exe.sha256
       PyInstaller + Inno Setup             site.config.json (version, URL, SHA-256, size)
       self-check, audit, SHA-256             └─ GitHub Pages: the website
```

Visitors never touch the private repository: the site and the installer are
both served from this public one, anonymously, over HTTPS.

## Layout

| Path | What it is |
|---|---|
| `site.config.json` | **The only place release facts live:** version, date, download URL, SHA-256, size, signed or not, supported Windows. |
| `src/pages/` | One HTML fragment per page, with a small JSON header (title, description, path). |
| `src/partials/layout.html` | Shared head, header, footer and the security policy. |
| `src/assets/` | CSS, the one small script, images, screenshots and the PDF documents. |
| `scripts/build.mjs` | The build (Node, no dependencies) → `dist/`. |
| `scripts/check-release.mjs` | Verifies the config against the installer file or the published release. |
| `scripts/optimize-images.py` | Turns application screenshots into the responsive WebP files. |
| `scripts/serve.mjs` | Local preview at the same path GitHub Pages uses. |
| `tests/site.test.mjs` | Links, assets, accessibility basics, security policy, download, version and claims. |
| `release-notes/` | The text of each GitHub release. |
| `.github/workflows/site.yml` | Test, verify the published installer, deploy to Pages. |

## Working on the site

Requires Node.js 20 or later. There are no npm dependencies.

```
npm test                 # build into a temp folder and check everything
npm run build            # -> dist/
npm run serve            # -> http://localhost:4173/ransomware-sentinel-site/
```

Keep the site honest. The tests reject claims the product can't back up
("100%", "detects all ransomware", "military-grade", ...), any version other
than the current one, inline scripts or styles, third-party resources,
anything that tracks visitors, local paths, secrets, and any link to the
private source repository. Screenshots of Safe Demo content must be labelled.

## Publishing a release

1. **Build the installer** in the private repository (see its
   `installer/README.md`):
   `scripts\build_release.py --tag vX.Y.Z` → `installer\out\X.Y.Z\`.
   Test it on Windows: install, first-run setup, protection, Safe Demo,
   uninstall.
2. **Write the release notes** in `release-notes/vX.Y.Z.md`.
3. **Update `site.config.json`**: `version`, `tag`, `date`, the three URLs
   (they contain the tag), `sha256` and `sizeBytes` from
   `release-manifest.json`, and `signed`. Then check it against the file:
   ```
   npm run check:release -- --file PATH\TO\RansomwareSentinel-Setup.exe
   npm test
   ```
4. **Publish the release** (needs the GitHub CLI, signed in with `gh auth login`):
   ```
   gh release create vX.Y.Z --repo h4timfr/ransomware-sentinel-site --target main ^
     --title "Ransomware Sentinel X.Y.Z" --notes-file release-notes/vX.Y.Z.md ^
     PATH\TO\RansomwareSentinel-Setup.exe PATH\TO\RansomwareSentinel-Setup.exe.sha256
   ```
5. **Commit and push** the config and notes to `main`. The workflow tests the
   site, downloads the new installer from the release and checks its SHA-256
   and size, and only then deploys the site.

The site links to the installer of one specific release, so the checksum on
the page always describes the file it links to. `/download/windows/` is a
stable address that always forwards to the current installer.

## Screenshots

The screenshots are captured from the real application by
`scripts/capture_screenshots.py` in the private repository (a throwaway
profile, the real first-run, protection and Safe Demo flows; no real user
names or files). Then:

```
python -m pip install pillow
python scripts/optimize-images.py PATH\TO\captured-pngs
```

## Hosting and privacy

GitHub Pages serves the site over HTTPS. The site uses no cookies, analytics,
trackers, third-party scripts or fonts. Every page carries a
Content-Security-Policy that only allows this site's own files. GitHub Pages
cannot set custom HTTP headers, so the policy is set with a `<meta>` tag
(which cannot express `frame-ancestors`); moving to a host that supports
headers (for example Cloudflare Pages) would allow that too.

To use a custom domain later, add `"customDomain": "example.org"` to
`site.config.json` (the build writes `CNAME`), change `siteUrl`, and set the
domain in the repository's Pages settings.

## License

No license has been published for this website or for Ransomware Sentinel.
The bundled third-party components' notices are installed with the
application (`THIRD-PARTY-NOTICES.txt`).
