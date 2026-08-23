import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sentryVitePlugin } from "@sentry/vite-plugin";
import react from "@vitejs/plugin-react";
import resolveConfig from "tailwindcss/resolveConfig";
import { defineConfig, Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import svgr from "vite-plugin-svgr";

import { renderCameraDetectionIconSprite } from "../scripts/camera-polygon-annotator/fontAwesomeIcons";
import {
  SEO_APP_NAME,
  SEO_DEFAULT_DESCRIPTION,
  SEO_DEFAULT_TITLE,
} from "../shared/lib/seo";
import tailwindConfig from "../tailwind.config.js";
import { clientBuildEnvDefines, clientViteAliases } from "./vite.shared";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "..");
const staticDir = path.resolve(configDir, "static");
const clientOutDir = path.resolve(repoRoot, "dist/client");
const cameraDetectionDebuggerHtml = path.resolve(
  repoRoot,
  "scripts/camera-polygon-annotator/index.html"
);
const rootStaticFiles = ["llms.txt", "openapi.json", "robots.txt"];
const cameraDetectionDebuggerRoutes = new Set([
  "/dev/camera-detection",
  "/dev/camera-detection/",
  "/dev/camera-detection/editor",
  "/dev/camera-detection/editor/",
  "/dev/camera-detection/benchmarks",
  "/dev/camera-detection/benchmarks/",
  "/dev/camera-detection/capture",
  "/dev/camera-detection/capture/",
]);
const cameraDetectionIconRoute = "/dev/camera-detection/icons.svg";
const { theme } = resolveConfig(tailwindConfig as never);
const colors = theme.colors as Record<string, Record<string, string>>;
const COLOR = colors.green.dark;
const BACKGROUND_COLOR = colors.blue.dark;

// Vite's development service-worker environment exposes only VITE_* values.
// Mirror the established public Firebase variables before Vite resolves env so
// both the page and the module service worker receive the same safe config.
for (const key of [
  "FIREBASE_API_KEY",
  "FIREBASE_APP_ID",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_SENDER_ID",
  "FIREBASE_VAPID_KEY",
] as const) {
  process.env[`VITE_${key}`] ??= process.env[key];
}

// read build env
const getEnv = (key: string, fallback?: string): string | undefined => {
  return process.env[key] ?? fallback;
};

// copy static assets
const copyStaticPlugin = (): Plugin => {
  return {
    name: "ferry-copy-static",
    // serve static assets
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestPath = new URL(request.url ?? "/", "http://localhost")
          .pathname;
        if (requestPath === "/.well-known/security.txt") {
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end(
            await fs.promises.readFile(path.resolve(staticDir, "security.txt"))
          );
          return;
        }
        const rootStaticFile = requestPath.slice(1);
        if (!rootStaticFiles.includes(rootStaticFile)) {
          next();
          return;
        }

        response.setHeader(
          "Content-Type",
          getContentType(path.resolve(staticDir, rootStaticFile))
        );
        response.end(
          await fs.promises.readFile(path.resolve(staticDir, rootStaticFile))
        );
      });
      server.middlewares.use("/static", async (request, response, next) => {
        const rawUrl = request.url ?? "/";
        // vite import guard
        if (rawUrl.includes("?")) {
          next();
          return;
        }
        const filePath = path.normalize(path.join(staticDir, rawUrl));
        // path traversal guard
        if (!filePath.startsWith(staticDir)) {
          next();
          return;
        }
        // file existence guard
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          next();
          return;
        }
        response.setHeader("Content-Type", getContentType(filePath));
        response.end(await fs.promises.readFile(filePath));
      });
    },
    // copy after build
    closeBundle() {
      fs.cpSync(staticDir, path.resolve(clientOutDir, "static"), {
        recursive: true,
      });
      rootStaticFiles.forEach((fileName) => {
        fs.copyFileSync(
          path.resolve(staticDir, fileName),
          path.resolve(clientOutDir, fileName)
        );
      });
      fs.mkdirSync(path.resolve(clientOutDir, ".well-known"), {
        recursive: true,
      });
      fs.copyFileSync(
        path.resolve(staticDir, "security.txt"),
        path.resolve(clientOutDir, ".well-known/security.txt")
      );
    },
  };
};

// serve development camera tools
const cameraDetectionDebuggerPlugin = (): Plugin => {
  return {
    name: "ferry-camera-detection-debugger",
    // mount debugger routes
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestPath = new URL(request.url ?? "/", "http://localhost")
          .pathname;
        // serve the directly imported Font Awesome subset
        if (requestPath === cameraDetectionIconRoute) {
          // read-only asset guard
          if (request.method !== "GET" && request.method !== "HEAD") {
            next();
            return;
          }
          const sprite = renderCameraDetectionIconSprite();
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
          response.statusCode = 200;
          response.end(request.method === "HEAD" ? undefined : sprite);
          return;
        }
        // unrelated route guard
        if (!cameraDetectionDebuggerRoutes.has(requestPath)) {
          next();
          return;
        }
        // read-only page guard
        if (request.method !== "GET" && request.method !== "HEAD") {
          next();
          return;
        }
        try {
          const html = await fs.promises.readFile(
            cameraDetectionDebuggerHtml,
            "utf8"
          );
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.statusCode = 200;
          response.end(request.method === "HEAD" ? undefined : html);
        } catch (error) {
          next(error as Error);
        }
      });
    },
  };
};

// infer static mime
const getContentType = (filePath: string): string => {
  const extension = path.extname(filePath);
  // mime lookup
  if (extension === ".png") {
    return "image/png";
  }
  // svg lookup
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  // favicon lookup
  if (extension === ".ico") {
    return "image/x-icon";
  }
  // html lookup
  if (extension === ".html") {
    return "text/html";
  }
  if (extension === ".woff2") {
    return "font/woff2";
  }
  if (extension === ".json") {
    return "application/json";
  }
  if (extension === ".txt") {
    return "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
};

// replace html placeholders
const htmlTemplatePlugin = (): Plugin => {
  return {
    name: "ferry-html-template",
    enforce: "pre",
    // transform html entry
    transformIndexHtml(html) {
      const baseUrl = getEnv("BASE_URL");
      // required base url guard
      if (!baseUrl) {
        throw new Error("Must set BASE_URL");
      }
      const values: Record<string, string> = {
        "%APP_DESCRIPTION%": SEO_DEFAULT_DESCRIPTION,
        "%APP_RELEASE_VERSION%":
          getEnv("HEROKU_RELEASE_VERSION", "UNKNOWN") ?? "UNKNOWN",
        "%APP_TITLE%": SEO_DEFAULT_TITLE,
        "%SEO_BASE_URL%": baseUrl,
        "%SOCIAL_IMAGE%": `${baseUrl}/static/images/social.png`,
        "%THEME_COLOR%": COLOR,
      };
      let output = html;
      // replace placeholders
      for (const [placeholder, value] of Object.entries(values)) {
        output = output.replaceAll(placeholder, value);
      }
      return output;
    },
  };
};

// gate sentry upload
const shouldUploadSentryRelease = (): boolean => {
  return (
    process.env.NODE_ENV === "production" &&
    Boolean(process.env.SENTRY_AUTH_TOKEN)
  );
};

// create vite config
export default defineConfig(() => ({
  root: configDir,
  publicDir: false,
  define: clientBuildEnvDefines(),
  resolve: {
    alias: clientViteAliases,
    preserveSymlinks: true,
  },
  server: {
    allowedHosts: ["dev.ferry.fyi"],
    host: "0.0.0.0",
    port: Number(process.env.DEV_CLIENT_PORT ?? "4040"),
    strictPort: true,
    proxy: {
      "/api":
        process.env.VITE_API_PROXY_TARGET ??
        `http://localhost:${process.env.PORT ?? "4040"}`,
      "/auth":
        process.env.VITE_API_PROXY_TARGET ??
        `http://localhost:${process.env.PORT ?? "4040"}`,
    },
  },
  css: {
    postcss: repoRoot,
  },
  build: {
    outDir: clientOutDir,
    emptyOutDir: true,
    // Publish source maps with every client build for browser debugging.
    sourcemap: true,
    minify: getEnv("MINIMIZE") === "FALSE" ? false : "esbuild",
    manifest: true,
    rollupOptions: {
      input: {
        main: path.resolve(configDir, "index.html"),
        offline: path.resolve(configDir, "offline.html"),
      },
      output: {
        assetFileNames: "assets/[name].[hash][extname]",
        chunkFileNames: "assets/[name].[hash].js",
        entryFileNames: "assets/[name].[hash].js",
        // consolidate automatic check-in runtime code
        manualChunks: (id: string): string | undefined => {
          // isolate optional web billing sdk
          if (id.includes("/node_modules/@revenuecat/purchases-js/")) {
            return "revenuecat-web-billing";
          }
          // feature module guard
          if (
            id.endsWith("/client/lib/leaderboardAutomatic.ts") ||
            id.endsWith("/client/lib/leaderboardNotifications.ts")
          ) {
            return "leaderboardAutomatic";
          }
          return undefined;
        },
      },
    },
  },
  plugins: [
    cameraDetectionDebuggerPlugin(),
    react(),
    svgr({
      include: "**/*.svg",
      svgrOptions: {
        icon: true,
        svgProps: { fill: "currentColor", className: "inline-block" },
      },
    }),
    htmlTemplatePlugin(),
    copyStaticPlugin(),
    VitePWA({
      srcDir: ".",
      filename: "service-worker.ts",
      strategies: "injectManifest",
      injectRegister: false,
      manifest: {
        id: "/",
        name: SEO_APP_NAME,
        short_name: SEO_APP_NAME,
        description: SEO_DEFAULT_DESCRIPTION,
        lang: "en-US",
        start_url: "/",
        scope: "/",
        display: "standalone",
        categories: ["navigation", "travel", "utilities"],
        background_color: BACKGROUND_COLOR,
        theme_color: COLOR,
        icons: [
          {
            src: "/static/images/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/static/images/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/static/images/icon_maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        related_applications: [{ platform: "play", id: "fyi.ferry" }],
        shortcuts: [
          {
            name: "Schedule",
            description: "View the schedule",
            url: "/",
            icons: [{ src: "/static/images/icons/solid/calendar-week.svg" }],
          },
          {
            name: "Tickets",
            description: "View saved tickets",
            url: "/tickets",
            icons: [{ src: "/static/images/icons/solid/barcode-alt.svg" }],
          },
        ],
      },
      injectManifest: {
        // Server-rendered documents and application bundles must never enter the
        // precache. Only the dedicated offline document and its isolated hashed
        // entry assets are available to failed navigations.
        globPatterns: [
          "offline.html",
          "assets/{offline,modulepreload-polyfill}.*.{js,css}",
        ],
        globIgnores: ["index.html", "**/*.map"],
        manifestTransforms: [
          (entries) => ({
            manifest: entries.filter(
              ({ url }) =>
                url === "offline.html" ||
                /^assets\/(?:offline|modulepreload-polyfill)\..+\.(?:js|css)$/.test(
                  url
                )
            ),
            warnings: [],
          }),
        ],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        rollupFormat: "iife",
      },
      integration: {
        beforeBuildServiceWorker: (options) => {
          options.injectManifest.additionalManifestEntries =
            options.injectManifest.additionalManifestEntries?.filter(
              (entry) =>
                (typeof entry === "string" ? entry : entry.url) !==
                options.manifestFilename
            );
        },
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
    // optional sentry upload
    ...(shouldUploadSentryRelease()
      ? [
          sentryVitePlugin({
            authToken: process.env.SENTRY_AUTH_TOKEN,
            org: "ferry-fyi",
            project: "web",
            release: {
              name: `web@${process.env.HEROKU_RELEASE_VERSION || "DEVELOPMENT"}`,
            },
            sourcemaps: {
              assets: path.resolve(clientOutDir, "**/*"),
              ignore: ["node_modules"],
            },
          }),
        ]
      : []),
  ],
}));
