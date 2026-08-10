import { writeFile } from "node:fs/promises";
import path from "node:path";

import { renderCameraDetectionIconSprite } from "./fontAwesomeIcons";

// write the standalone-server icon subset
const generateIcons = async (): Promise<void> => {
  await writeFile(
    path.resolve(__dirname, "icons.svg"),
    renderCameraDetectionIconSprite(),
    "utf8"
  );
};

generateIcons().catch((error: unknown) => {
  // surface generation failures
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
