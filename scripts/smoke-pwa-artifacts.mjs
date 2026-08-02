/* global console */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const clientDirectory = path.resolve("dist/client");
const readClientFile = (file) =>
  readFile(path.join(clientDirectory, file), "utf8");

const [
  serviceWorker,
  indexHtml,
  offlineHtml,
  viteManifestJson,
  robotsTxt,
  llmsTxt,
] = await Promise.all([
  readClientFile("service-worker.js"),
  readClientFile("index.html"),
  readClientFile("offline.html"),
  readClientFile(".vite/manifest.json"),
  readClientFile("robots.txt"),
  readClientFile("llms.txt"),
]);

assert.match(
  robotsTxt,
  /^User-agent:/m,
  "built robots.txt must contain crawler policy"
);
assert.match(
  robotsTxt,
  /^Sitemap: https:\/\/ferry\.fyi\/sitemap\.xml$/m,
  "built robots.txt must advertise the canonical sitemap"
);
assert.match(llmsTxt, /^# Ferry FYI$/m, "built llms.txt must identify Ferry FYI");
assert.match(
  llmsTxt,
  /^## AI API guide$/m,
  "built llms.txt must include the public API guide"
);

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
const collectStaticManifestEntries = (entryKey, collected = new Set()) => {
  if (collected.has(entryKey)) {
    return collected;
  }
  const entry = viteManifest[entryKey];
  assert.ok(entry, `manifest import is missing: ${entryKey}`);
  collected.add(entryKey);
  for (const importedEntry of entry.imports ?? []) {
    collectStaticManifestEntries(importedEntry, collected);
  }
  return collected;
};
const browserAppClosure = collectStaticManifestEntries("browserApp.tsx");
const sentryDynamicEntries = viteManifest["lib/sentry.ts"]?.dynamicImports ?? [];
for (const sentryEntry of sentryDynamicEntries) {
  assert.ok(
    !browserAppClosure.has(sentryEntry),
    `browser app static closure must exclude deferred Sentry entry: ${sentryEntry}`
  );
}
assert.ok(
  ![...browserAppClosure].some((entryKey) =>
    /sentry|spotlight/i.test(
      `${entryKey} ${viteManifest[entryKey]?.file ?? ""}`
    )
  ),
  "browser app static closure must exclude Sentry chunks"
);
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
assert.ok(!applicationStylesheetTag.includes("media="));
assert.ok(!applicationStylesheetTag.includes("onload="));
assert.ok(!indexHtml.includes("ferry-fyi-ssr-style-gate"));
assert.ok(!indexHtml.includes("data-ferry-fyi-styles-ready"));
assert.ok(!indexHtml.includes('href="/app.scss"'));

const applicationCss = await readClientFile(applicationStylesheet);
const fontAssets = [
  ...applicationCss.matchAll(
    /url\(\/(assets\/ferry-sans-flex-[^)]+\.woff2)\)/g
  ),
].map((match) => match[1]);
assert.equal(fontAssets.length, 2, "application CSS must reference both fonts");
for (const fontAsset of fontAssets) {
  const font = await readFile(path.join(clientDirectory, fontAsset));
  assert.equal(
    font.subarray(0, 4).toString("ascii"),
    "wOF2",
    `${fontAsset} must be a valid WOFF2 container`
  );
}

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
