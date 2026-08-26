import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const clientDir = path.join(repoRoot, "dist/client");
const rendererPath = path.join(repoRoot, "dist/ssr/entry-server.mjs");
const forecastWorkerPath = path.join(
  repoRoot,
  "dist/server/forecast-worker.js"
);
const serverPath = path.join(repoRoot, "dist/server/server.js");
const serverArtifactSmokePath = path.join(
  repoRoot,
  "dist/server/artifact-smoke.js"
);
const manifestPath = path.join(clientDir, ".vite/manifest.json");

const requireFile = async (filePath) => {
  try {
    await stat(filePath);
  } catch {
    throw new Error(`Missing production artifact: ${path.relative(repoRoot, filePath)}`);
  }
};

await Promise.all([
  requireFile(path.join(clientDir, "index.html")),
  requireFile(manifestPath),
  requireFile(rendererPath),
  requireFile(forecastWorkerPath),
  requireFile(serverPath),
  requireFile(serverArtifactSmokePath),
]);

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Object.values(manifest).some((entry) => entry.isEntry)) {
  throw new Error("Client manifest does not contain a browser entry");
}

// The CJS application may load the deployable ESM renderer but must never
// acquire its own ReactDOM rendering graph. This keeps the runtime image free
// of dev-only React renderer packages and ensures one production renderer.
const serverChunks = await readdir(path.dirname(serverPath), {
  recursive: true,
});
const serverBundleText = await Promise.all(
  serverChunks
    .filter((entry) => entry.endsWith(".js"))
    .map((entry) => readFile(path.join(path.dirname(serverPath), entry), "utf8"))
);
if (
  serverChunks.some((entry) =>
    /(?:ssr-fixture-server|__fixture__)/i.test(entry)
  ) ||
  serverBundleText.some(
    (bundle) =>
      bundle.includes("ssr-fixture-server") ||
      bundle.includes("/__fixture__/")
  )
) {
  throw new Error("Production server artifacts contain SSR fixture controls");
}
if (serverBundleText.some((bundle) => bundle.includes("react-dom/server"))) {
  throw new Error("CJS server artifact must not include react-dom/server");
}

// Import from a clean temporary directory. Any accidental dependency on a
// dev-only package would then fail Node resolution before a production image.
const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "ferry-ssr-runtime-"));
try {
  const isolatedRenderer = path.join(runtimeDir, "entry-server.mjs");
  await writeFile(isolatedRenderer, await readFile(rendererPath));
  const renderer = await import(pathToFileURL(isolatedRenderer).href);
  if (
    renderer.artifactVersion !== 1 ||
    typeof renderer.renderPublicSsrDocument !== "function"
  ) {
    throw new Error("SSR renderer export contract is invalid");
  }
  let rendered;
  try {
    rendered = await renderer.renderPublicSsrDocument({
      renderedAt: Date.parse("2026-07-28T12:00:00.000Z"),
      requestUrl: "https://ferry.fyi/404",
      seoBaseUrl: "https://ferry.fyi",
      seoHost: "ferry.fyi",
      seoPathname: "/404",
      snapshot: {
        canonicalHost: "ferry.fyi",
        canonicalPath: "/404",
        hostProfile: "ferry.fyi",
        indexability: "noindex",
        metadata: {
          canonicalPath: "/404",
          description: "The requested Ferry FYI page could not be found.",
          robots: "noindex,follow",
          title: "Page Not Found - Ferry FYI",
        },
        normalizedUrl: { path: "/404", query: {} },
        renderedAt: "2026-07-28T12:00:00.000Z",
        routeId: "unknown-public-path",
        routeParams: {},
        sources: {},
        version: 6,
      },
      template:
        "<html><head></head><body><div id=\"root\"></div></body></html>",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown failure";
    throw new Error(`Isolated SSR render failed: ${message}`);
  }
  if (rendered.mode !== "snapshot" || !rendered.html.includes("Page not found")) {
    throw new Error("SSR renderer did not produce a document from the isolated artifact");
  }
  const homeRendered = await renderer.renderPublicSsrDocument({
    renderedAt: Date.parse("2026-07-28T12:00:00.000Z"),
    requestUrl: "https://ferry.fyi/",
    seoBaseUrl: "https://ferry.fyi",
    seoHost: "ferry.fyi",
    seoPathname: "/",
    snapshot: {
      canonicalHost: "ferry.fyi",
      canonicalPath: "/",
      hostProfile: "ferry.fyi",
      indexability: "indexable",
      metadata: {
        canonicalPath: "/",
        description: "Washington State ferry schedules and terminal status.",
        robots: "index,follow",
        title: "Ferry FYI",
      },
      normalizedUrl: { path: "/", query: {} },
      renderedAt: "2026-07-28T12:00:00.000Z",
      routeId: "home",
      routeParams: {},
      sources: {
        ad: {
          observedAt: "2026-07-28T12:00:00.000Z",
          outcome: "value",
          sourceUpdatedAt: null,
          value: { creative: null, placementKey: "home" },
        },
        features: {
          observedAt: "2026-07-28T12:00:00.000Z",
          outcome: "value",
          sourceUpdatedAt: null,
          value: { leaderboardsEnabled: true },
        },
        notices: {
          observedAt: "2026-07-28T12:00:00.000Z",
          outcome: "empty",
          sourceUpdatedAt: null,
          value: {
            announcements: [],
            maintenance: { enabled: false, message: "" },
          },
        },
        terminals: {
          observedAt: "2026-07-28T12:00:00.000Z",
          outcome: "empty",
          sourceUpdatedAt: null,
          value: [],
        },
      },
      version: 6,
    },
    template:
      "<html><head></head><body><div id=\"root\"></div></body></html>",
  });
  if (
    homeRendered.mode !== "snapshot" ||
    !homeRendered.html.includes('aria-label="Quick links"') ||
    !homeRendered.html.includes(">Ferry FYI</h1>") ||
    !/<img\b(?=[^>]*\balt="")(?=[^>]*\bsrc="data:image\/png;base64,[^"]+")[^>]*>/.test(
      homeRendered.html
    )
  ) {
    throw new Error("SSR renderer did not produce the public home hero");
  }
  const homeAssetPaths = [
    ...homeRendered.html.matchAll(/<img\b[^>]*\bsrc="(\/[^"]+)"/g),
  ].map((match) => new URL(match[1], "https://ferry.fyi").pathname);
  await Promise.all(
    homeAssetPaths.map((assetPath) =>
      requireFile(path.join(clientDir, assetPath.slice(1)))
    )
  );
} finally {
  await rm(runtimeDir, { force: true, recursive: true });
}

console.log("SSR production artifact smoke check passed");
