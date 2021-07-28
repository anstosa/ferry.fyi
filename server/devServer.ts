import nodemon from "nodemon";

nodemon({
  watch: ["."],
  script: "server.ts",
  exec: "ts-node -r tsconfig-paths/register server.ts",
  ext: "ts",
});

const onExit = (): void => {
  console.debug("Stopping dev server...");
};

nodemon
  .on("start", (): void => {
    console.debug("Starting dev server...");
  })
  .on("restart", (): void => {
    console.debug("\n\n\nServer source changed, restarting!");
  })
  .on("crash", onExit)
  .on("quit", onExit);

process.on("SIGTERM", onExit);
