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
application repository (private)           this repository (public)
────────────────────────────────           ───────────────────────────────────
release tag vX.Y.Z                         GitHub release vX.Y.Z
  └─ installer build  ─────upload─────►      RansomwareSentinel-Setup.exe
                                             RansomwareSentinel-Setup.exe.sha256
                                           site.config.json (version, URL, SHA-256, size)
                                             └─ GitHub Pages: the website
```

Visitors never touch the private repository: the site and the installer are
both served from this public one, anonymously, over HTTPS.

## Layout

| Path | What it is |
|---|---|
| `site.config.json` | **The only place release facts live:** version, date, download URL, SHA-256, size, signed or not, supported Windows; and the state of other platforms (`platforms.macos`). |
| `src/pages/` | One HTML fragment per page, with a small JSON header (title, description, path). |
| `src/partials/layout.html` | Shared head, header, footer and the security policy. |
| `src/partials/platforms.html` | The Windows and macOS platform cards, shared by the home and download pages. |
| `vercel.json` | HTTP security headers for the Vercel deployment (headers only). |
| `src/assets/` | CSS, the one small script, icons, the social preview image and the screenshots. |
| `scripts/build.mjs` | The build (Node, no dependencies) → `dist/`. |
| `scripts/check-release.mjs` | Verifies the config against the installer file or the published release. |
| `scripts/optimize-images.py` | Turns application screenshots into the responsive WebP files. |
| `scripts/serve.mjs` | Local preview at the same path GitHub Pages uses. |
| `tests/site.test.mjs` | Links, assets, accessibility basics, security policy, download, version, claims and leak checks. |
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
anything that tracks visitors, secrets, and any link to the private source
repository. They also scan the repository and the built site for anything
from a developer's machine: user-profile, home and application-data paths, local
addresses, IP and email addresses, internal branch names and image metadata.
No PDFs, Office documents or archives are published. Screenshots of Safe Demo
content must be labelled.

## Publishing a release

1. **Build the installer** from the release tag in the application
   repository, following its own release instructions. Test it on Windows:
   install, first-run setup, protection, Safe Demo, uninstall.
2. **Write the release notes** in `release-notes/vX.Y.Z.md`.
3. **Update `site.config.json`**: `version`, `tag`, `date`, the three URLs
   (they contain the tag), `sha256` and `sizeBytes` of the installer, and
   `signed`. Then check it against the file:
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

The screenshots are full-window captures of the released version of the
application, taken under a throwaway demo profile through the real first-run,
protection and Safe Demo flows. Before publishing one, check that it shows the
current version and no real user name, machine name, path, file or branch
name. Anything showing an alert or incident must come from the Safe Demo and
is labelled as such on the page. Only the screenshots listed in
`scripts/optimize-images.py` are published:

```
python -m pip install pillow
python scripts/optimize-images.py PATH\TO\captured-pngs
```

## Hosting and privacy

The site is deployed to Vercel (from `main`, by the Vercel GitHub integration)
and to GitHub Pages (by the workflow). It uses no cookies, analytics,
trackers, third-party scripts or fonts. Every page carries a
Content-Security-Policy `<meta>` tag that only allows this site's own files.
On Vercel, `vercel.json` also sends the same policy as an HTTP header, plus
`frame-ancestors 'none'` (which a `<meta>` tag cannot express) and the usual
hardening headers; a test keeps the two policies identical. GitHub Pages
cannot set custom headers.

## Platforms

Only Windows is released. `platforms.macos.status` in `site.config.json` is
`"coming-soon"`, which renders a macOS card with no download. Setting it to
`"available"` is refused by the build unless the entry also has a `version`,
a public release `downloadUrl`, `sha256`, `sizeBytes` and `requirements`, so
the site cannot offer a macOS download that does not exist.

To use a custom domain later, add `"customDomain": "example.org"` to
`site.config.json` (the build writes `CNAME`), change `siteUrl`, and set the
domain in the repository's Pages settings.

## License

No license has been published for this website or for Ransomware Sentinel.
The bundled third-party components' notices are installed with the
application (`THIRD-PARTY-NOTICES.txt`).
