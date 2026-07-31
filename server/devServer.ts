import nodemon from "nodemon";

let isShuttingDown = false;

nodemon({
  legacyWatch: process.env.CHOKIDAR_USEPOLLING === "true",
  watch: [".", "../shared"],
  script: "development.ts",
  exec: "node ../scripts/register-esbuild.js",
  ext: "ts",
});

const onExit = (): void => {
  console.debug("Stopping dev server...");
};

const shutdown = (): void => {
  // duplicate signal guard
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  onExit();
  nodemon.emit("quit");
  // finish shutdown
  setTimeout(() => {
    process.exit(0);
  }, 100).unref();
};

nodemon
  .on("start", (): void => {
    console.debug("Starting dev server...");
  })
  .on("restart", (): void => {
    console.debug("\n\n\nServer source changed, restarting!");
  })
  .on("crash", shutdown)
  .on("quit", onExit);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);
