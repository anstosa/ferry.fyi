import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const clientDirectory = path.resolve("dist/client");
const readClientFile = (file) =>
  readFile(path.join(clientDirectory, file), "utf8");

const [serviceWorker, indexHtml, offlineHtml, viteManifestJson] =
  await Promise.all([
    readClientFile("service-worker.js"),
    readClientFile("index.html"),
    readClientFile("offline.html"),
    readClientFile(".vite/manifest.json"),
  ]);

const precacheUrls = [
  ...serviceWorker.matchAll(/["']url["']\s*:\s*["']([^"']+)["']/g),
].map((match) => match[1]);
const viteManifest = JSON.parse(viteManifestJson);
const indexManifestEntry = viteManifest["index.html"];
const offlineManifestEntry = viteManifest["offline.html"];
assert.ok(indexManifestEntry, "index Vite manifest entry is required");
assert.ok(offlineManifestEntry, "offline Vite manifest entry is required");
const collectEntryAssets = (entryKey, collected = new Set()) => {
  const entry = viteManifest[entryKey];
  assert.ok(entry, `offline manifest import is missing: ${entryKey}`);
  collected.add(entry.file);
  for (const css of entry.css ?? []) {
    collected.add(css);
  }
  for (const importedEntry of entry.imports ?? []) {
    collectEntryAssets(importedEntry, collected);
  }
  return collected;
};
const offlineAssetClosure = [...collectEntryAssets("offline.html")];
const [applicationStylesheet] = indexManifestEntry.css ?? [];

assert.ok(applicationStylesheet, "application stylesheet is required");
const escapedApplicationStylesheet = applicationStylesheet.replace(
  /[.*+?^${}()|[\]\\]/g,
  "\\$&"
);
const applicationStylesheetTag = indexHtml.match(
  new RegExp(
    `<link\\b[^>]*\\bhref=["']/${escapedApplicationStylesheet}["'][^>]*>`
  )
)?.[0];
assert.ok(
  applicationStylesheetTag,
  "built index must link the application CSS"
);
assert.ok(
  applicationStylesheetTag.includes(
    `onload="document.documentElement.setAttribute('data-ferry-fyi-styles-ready', '')"`
  ),
  "built application stylesheet must release the SSR style gate on load"
);
assert.match(
  indexHtml,
  /html:not\(\[data-ferry-fyi-styles-ready\]\)[\s\S]*#root\[data-ferry-fyi-render-mode="snapshot"\]/,
  "built index must include the SSR style gate"
);
assert.ok(!indexHtml.includes('href="/app.scss"'));

assert.deepEqual(
  [...precacheUrls].sort(),
  ["offline.html", ...offlineAssetClosure].sort(),
  "precache must contain exactly offline.html and its hashed JS/CSS closure"
);
assert.equal(
  offlineAssetClosure.filter((asset) => asset.endsWith(".css")).length,
  1,
  "offline shell must have one isolated CSS asset"
);
for (const asset of offlineAssetClosure) {
  assert.match(
    asset,
    /^assets\/(?:offline|modulepreload-polyfill)\.[A-Za-z0-9_-]+\.(?:js|css)$/
  );
  assert.ok(
    offlineHtml.includes(`/${asset}`),
    `offline document must reference ${asset}`
  );
}
assert.ok(!precacheUrls.some((url) => url === "index.html"));
assert.ok(!precacheUrls.some((url) => url.endsWith(".map")));
assert.ok(
  !precacheUrls.some(
    (url) => url.endsWith(".html") && url !== "offline.html"
  )
);
assert.ok(!precacheUrls.some((url) => /^assets\/main\./.test(url)));

assert.match(
  offlineHtml,
  /<meta name="robots" content="noindex,nofollow"\s*\/>/
);
assert.match(offlineHtml, /content="csr-offline"/);
assert.match(offlineHtml, /data-document-mode="csr-offline"/);
for (const forbidden of [
  "ferry-fyi-public-ssr-snapshot",
  "__FERRY_FYI_BOOTSTRAP__",
  "entry-client",
  "data-render-mode",
]) {
  assert.ok(
    !offlineHtml.includes(forbidden),
    `offline document must exclude ${forbidden}`
  );
}

const offlineBundle = (
  await Promise.all(offlineAssetClosure.map(readClientFile))
).join("\n");
for (const forbidden of [
  "auth0",
  "/api/",
  "ferry-fyi-public-ssr-snapshot",
  "__FERRY_FYI_BOOTSTRAP__",
  "access_token",
  "savedTickets",
]) {
  assert.ok(
    !offlineBundle.toLowerCase().includes(forbidden.toLowerCase()),
    `offline asset closure must exclude ${forbidden}`
  );
}

console.log(
  `PWA artifacts verified: ${precacheUrls.sort().join(", ")}`
);
