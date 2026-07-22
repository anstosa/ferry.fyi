import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sentryVitePlugin } from "@sentry/vite-plugin";
import react from "@vitejs/plugin-react";
import resolveConfig from "tailwindcss/resolveConfig";
import { defineConfig, Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import svgr from "vite-plugin-svgr";

import { OTA_CLIENT_ENV_KEYS } from "../shared/contracts/ota";
import {
  SEO_APP_NAME,
  SEO_DEFAULT_DESCRIPTION,
  SEO_DEFAULT_TITLE,
} from "../shared/lib/seo";
import tailwindConfig from "../tailwind.config.js";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "..");
const staticDir = path.resolve(configDir, "static");
const clientOutDir = path.resolve(repoRoot, "dist/client");
const rootStaticFiles = ["llms.txt", "robots.txt"];
const envKeys = [
  "AUTH0_CLIENT_AUDIENCE",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_REDIRECT",
  "AUTH0_DOMAIN",
  "BASE_URL",
  "FIREBASE_API_KEY",
  "FIREBASE_APP_ID",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_SENDER_ID",
  "FIREBASE_VAPID_KEY",
  "GOOGLE_ANALYTICS",
  "GTM_CONTAINER_ID",
  "HEROKU_RELEASE_VERSION",
  "LOG_LEVEL",
  "MAPBOX_ACCESS_TOKEN",
  "NODE_ENV",
  "SENTRY_DSN",
  ...OTA_CLIENT_ENV_KEYS,
];
const { theme } = resolveConfig(tailwindConfig as never);
const colors = theme.colors as Record<string, Record<string, string>>;
const COLOR = colors.green.dark;
const BACKGROUND_COLOR = colors.blue.dark;

// read build env
const getEnv = (key: string, fallback?: string): string | undefined => {
  return process.env[key] ?? fallback;
};

// preserve process.env access
const buildEnvDefines = (): Record<string, string> => {
  const defines: Record<string, string> = {};
  // expose env keys
  for (const key of envKeys) {
    const value = getEnv(
      key,
      key === "HEROKU_RELEASE_VERSION" ? "DEVELOPMENT" : undefined
    );
    defines[`process.env.${key}`] = JSON.stringify(value);
  }
  return defines;
};

// copy static assets
const copyStaticPlugin = (): Plugin => {
  return {
    name: "ferry-copy-static",
    // serve static assets
    configureServer(server) {
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
  define: buildEnvDefines(),
  resolve: {
    alias: {
      "~": configDir,
      lib: path.resolve(configDir, "lib"),
      shared: path.resolve(repoRoot, "shared"),
    },
    preserveSymlinks: true,
  },
  server: {
    allowedHosts: ["ferry-fyi.santosa.family"],
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
  build: {
    outDir: clientOutDir,
    emptyOutDir: true,
    // Publish source maps with every client build for browser debugging.
    sourcemap: true,
    minify: getEnv("MINIMIZE") === "FALSE" ? false : "esbuild",
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name].[hash][extname]",
        chunkFileNames: "assets/[name].[hash].js",
        entryFileNames: "assets/[name].[hash].js",
      },
    },
  },
  plugins: [
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
        globIgnores: ["**/*.js", "**/*.css", "**/*.map"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        rollupFormat: "iife",
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
