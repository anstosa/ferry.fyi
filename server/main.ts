import logger from "~/lib/logger";

import { startServer } from "./server";

startServer().catch((error: Error) => {
  logger.error(`Server startup failed: ${error.message}`, error);
  process.exit(1);
});
