// Verify that site.config.json describes a real, published installer.
//
//   node scripts/check-release.mjs --file PATH\RansomwareSentinel-Setup.exe
//       before publishing: the config matches the file you are about to upload
//   node scripts/check-release.mjs --remote
//       after publishing (and in the deploy workflow): download the installer and
//       its .sha256 from the public release and check both against the config
//
// Exits non-zero on any mismatch, so the site is never deployed pointing at a
// missing or different file.

import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { loadConfig } from "./build.mjs";

const { release, publicRepoUrl } = loadConfig();
const args = process.argv.slice(2);
const fail = (message) => { console.error(`Release check failed: ${message}`); process.exit(1); };

if (!/^[0-9a-f]{64}$/.test(release.sha256)) fail("release.sha256 is not a 64-character lowercase hex SHA-256.");
if (!(release.sizeBytes > 0)) fail("release.sizeBytes is not set.");
if (!release.downloadUrl.startsWith(`${publicRepoUrl}/releases/download/${release.tag}/`)) {
  fail(`downloadUrl must be a ${release.tag} asset of ${publicRepoUrl}.`);
}

async function sha256OfStream(stream) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest("hex"), bytes };
}

function compare(label, actual) {
  if (actual.sha256 !== release.sha256) fail(`${label} SHA-256 is ${actual.sha256}, config says ${release.sha256}.`);
  if (actual.bytes !== release.sizeBytes) fail(`${label} is ${actual.bytes} bytes, config says ${release.sizeBytes}.`);
  console.log(`${label}: SHA-256 and size match (${actual.bytes} bytes).`);
}

const fileIndex = args.indexOf("--file");
if (fileIndex !== -1) {
  const path = args[fileIndex + 1];
  if (!path) fail("--file needs a path.");
  statSync(path);
  compare(path, await sha256OfStream(createReadStream(path)));
}

if (args.includes("--remote")) {
  const response = await fetch(release.downloadUrl, { redirect: "follow" });
  if (!response.ok) fail(`${release.downloadUrl} answered HTTP ${response.status}.`);
  compare(release.downloadUrl, await sha256OfStream(response.body));
  const sums = await fetch(release.checksumUrl, { redirect: "follow" });
  if (!sums.ok) fail(`${release.checksumUrl} answered HTTP ${sums.status}.`);
  const [digest, name] = (await sums.text()).trim().split(/\s+\*?/);
  if (digest.toLowerCase() !== release.sha256) fail(`the published .sha256 file says ${digest}.`);
  if (name !== release.installerFile) fail(`the published .sha256 file names ${name}, not ${release.installerFile}.`);
  console.log(`${release.checksumUrl}: matches.`);
}

if (fileIndex === -1 && !args.includes("--remote")) console.log("Config is complete (pass --file or --remote to verify the installer itself).");
