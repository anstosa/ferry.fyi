import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createStaticPolicyRouter,
  createStaticRouter,
} from "~/controllers/static";
import { dbInit } from "~/lib/db";
import { initializeWsfSeed } from "~/lib/wsf";
import { createSsrRuntime } from "~/ssr/composition";

import { shouldRunScheduler } from "./lib/serverRuntime";
import { createApp, startScheduler, startWsfCacheRefreshJobs } from "./server";

const repoRoot = path.resolve(__dirname, "..");
const clientDirectory = path.join(repoRoot, "client");

/** Starts one Express/Vite development process for API, HTML, and assets. */
const startDevelopmentServer = async (): Promise<void> => {
  // @ts-expect-error Vite 8 is ESM-only while this server still compiles as CJS.
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    appType: "custom",
    configFile: path.join(clientDirectory, "vite.config.ts"),
    server: { middlewareMode: true },
  });
  const rawTemplate = await readFile(
    path.join(clientDirectory, "index.html"),
    "utf8"
  );
  const documentRuntime = async (absoluteUrl: string) => {
    const url = new URL(absoluteUrl);
    try {
      const runtime = await createSsrRuntime({
        artifacts: {
          getRenderer: () =>
            vite.ssrLoadModule("/entry-server.tsx") as Promise<never>,
          getTemplate: () =>
            vite.transformIndexHtml(
              `${url.pathname}${url.search}`,
              rawTemplate
            ),
        },
        config: { cacheEnabled: false, enabled: true },
      });
      return await runtime(absoluteUrl);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      throw error;
    }
  };

  await dbInit;
  initializeWsfSeed();
  const app = createApp({
    publicMiddleware: createStaticPolicyRouter(clientDirectory, {
      llmsPath: path.join(clientDirectory, "static", "llms.txt"),
    }),
    staticHandler: createStaticRouter(clientDirectory, {
      browserDependencies: { documentRuntime },
      llmsPath: path.join(clientDirectory, "static", "llms.txt"),
      serveStaticAssets: false,
    }),
    webMiddleware: vite.middlewares,
  });
  const port = Number(process.env.PORT ?? 4040);
  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.info(`Development server started on port ${port}`);
  });
  if (shouldRunScheduler()) {
    startScheduler();
  } else {
    startWsfCacheRefreshJobs();
  }
  const shutdown = () => {
    server.close(() => {
      vite.close().finally(() => process.exit(0));
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

startDevelopmentServer().catch((error: Error) => {
  // eslint-disable-next-line no-console
  console.error(`Development server startup failed: ${error.message}`);
  process.exit(1);
});
