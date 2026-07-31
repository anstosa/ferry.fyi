import { loadProductionSsrArtifacts } from "./artifacts";

/**
 * Production-only smoke entry. It deliberately does not start Express, open a
 * database connection, or schedule jobs; it proves the compiled CJS loader
 * resolves the sibling dist/client and dist/ssr artifacts as deployed.
 */
const run = async (): Promise<void> => {
  const artifacts = await loadProductionSsrArtifacts(__dirname);
  await Promise.all([artifacts.getRenderer(), artifacts.getTemplate()]);
  // eslint-disable-next-line no-console
  console.info("Compiled CJS SSR artifact loader smoke check passed");
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  // eslint-disable-next-line no-console
  console.error(`Compiled CJS SSR artifact loader smoke failed: ${message}`);
  process.exitCode = 1;
});
