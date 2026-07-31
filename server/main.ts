import logger from "heroku-logger";

import { startServer } from "./server";

startServer().catch((error: Error) => {
  logger.error(`Server startup failed: ${error.message}`, error);
  process.exit(1);
});
