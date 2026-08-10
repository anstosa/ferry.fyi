import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const recorderPath = path.join(
  repositoryRoot,
  "scripts/record-camera-detection-frames.py"
);
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "ferry-camera-recorder-")
);
const outputDir = path.join(temporaryRoot, "capture-session");
const configPath = path.join(temporaryRoot, "camera-config.json");
const jpegBody = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.alloc(2048, 0x7f),
  Buffer.from([0xff, 0xd9]),
]);
let requestCount = 0;
let server: http.Server;
let serverUrl: string;

// start the image fixture server
const startServer = async (): Promise<void> => {
  // fixture response handler
  server = http.createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { "Content-Type": "image/jpeg" });
    response.end(jpegBody);
  });
  // listen completion
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  // bound address guard
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind a TCP port");
  }
  serverUrl = `http://127.0.0.1:${address.port}/camera.jpg`;
};

// write the camera fixture
const writeCameraConfig = (): void => {
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        cameraIds: ["enabled", "disabled", "unreviewed"],
        cameras: {
          disabled: {
            allowedAreas: [{ id: "disabled-area" }],
            detectionEnabled: false,
            imageUrl: serverUrl,
            reviewed: true,
          },
          enabled: {
            allowedAreas: [{ id: "enabled-area" }],
            displayName: "Enabled camera",
            frameSize: { height: 100, width: 200 },
            imageUrl: serverUrl,
            reviewed: true,
          },
          unreviewed: {
            allowedAreas: [{ id: "unreviewed-area" }],
            imageUrl: serverUrl,
            reviewed: false,
          },
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
};

// run one capture round
const runRecorder = async (
  targetOutputDir = outputDir,
  extraArgs: string[] = ["--once"]
): Promise<void> => {
  await execFileAsync("python3", [
    recorderPath,
    "--camera-config",
    configPath,
    "--minimum-free-gib",
    "0.001",
    "--output-dir",
    targetOutputDir,
    "--request-timeout",
    "2",
    "--session-id",
    "test-session",
    ...extraArgs,
  ]);
};

// fixture setup
beforeAll(async () => {
  await startServer();
  writeCameraConfig();
});

// isolate recorder assertions
beforeEach(() => {
  requestCount = 0;
  fs.rmSync(outputDir, { force: true, recursive: true });
});

// fixture cleanup
afterAll(async () => {
  // server cleanup guard
  if (server) {
    await new Promise<void>((resolve, reject) => {
      // close completion
      server.close((error) => {
        // close error guard
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
  fs.rmSync(temporaryRoot, { recursive: true });
});

describe("camera detection recorder", () => {
  // enabled-camera and deduplication contract
  it("records enabled cameras and retains duplicate metadata", async () => {
    await runRecorder();
    await runRecorder();

    const session = JSON.parse(
      fs.readFileSync(path.join(outputDir, "session.json"), "utf8")
    );
    const records = fs
      .readFileSync(path.join(outputDir, "manifest.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const frameFiles = fs.readdirSync(path.join(outputDir, "frames"));

    expect(requestCount).toBe(2);
    expect(session.cameraIds).toEqual(["enabled"]);
    expect(session.captureAttempts).toBe(2);
    expect(session.roundsCompleted).toBe(2);
    expect(session.storedFrames).toBe(1);
    expect(session.duplicateFrames).toBe(1);
    expect(session.failedFrames).toBe(0);
    expect(session.status).toBe("completed");
    expect(frameFiles).toHaveLength(1);
    expect(records.map(({ status }) => status)).toEqual([
      "stored",
      "duplicate",
    ]);
    expect(records[1].duplicateOf).toBe(records[0].file);
  });

  // selected bounded-run contract
  it("stops at the selected per-camera image limit", async () => {
    await runRecorder(outputDir, [
      "--camera-id",
      "enabled",
      "--image-limit",
      "2",
      "--interval-seconds",
      "1",
    ]);

    const session = JSON.parse(
      fs.readFileSync(path.join(outputDir, "session.json"), "utf8")
    );
    expect(requestCount).toBe(2);
    expect(session.cameraIds).toEqual(["enabled"]);
    expect(session.imageLimit).toBe(2);
    expect(session.roundsCompleted).toBe(2);
    expect(session.status).toBe("completed");
  });

  // fatal session state contract
  it("marks fatal recorder failures for file management", async () => {
    await expect(
      runRecorder(outputDir, ["--once", "--minimum-free-gib", "999999"])
    ).rejects.toThrow();

    const session = JSON.parse(
      fs.readFileSync(path.join(outputDir, "session.json"), "utf8")
    );
    expect(session.error).toContain("Available disk space");
    expect(session.status).toBe("failed");
  });
});
