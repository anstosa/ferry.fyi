import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type CameraCaptureRunPaths,
  deleteCameraCaptureRun,
  importCameraCaptureRun,
  stopCameraCaptureRun,
} from "~/lib/cameraDetectionCaptureRuns";

interface CaptureRunFixture {
  paths: CameraCaptureRunPaths;
  root: string;
}

// create one isolated capture fixture
const createFixture = async (): Promise<CaptureRunFixture> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ferry-capture-runs-"));
  const benchmarkRoot = path.join(root, "benchmark");
  const captureRoot = path.join(root, "captures");
  const paths = {
    annotationFile: path.join(root, "annotations.json"),
    benchmarkManifestFile: path.join(benchmarkRoot, "manifest.json"),
    benchmarkRoot,
    captureRoot,
    recorderScript: path.join(root, "recorder.py"),
  };
  await Promise.all([
    mkdir(benchmarkRoot),
    mkdir(captureRoot),
    writeFile(path.join(root, "annotations.json"), "{}"),
    writeFile(path.join(root, "recorder.py"), ""),
  ]);
  await writeFile(paths.benchmarkManifestFile, JSON.stringify({ frames: [] }));
  return { paths, root };
};

// write one completed raw capture run
const writeCompletedRun = async (
  runDirectory: string,
  manifestRecords: Array<Record<string, unknown>> = []
): Promise<void> => {
  await mkdir(path.join(runDirectory, "frames"), { recursive: true });
  // serialize manifest rows
  const manifestContents = manifestRecords
    .map((record) => JSON.stringify(record))
    .join("\n");
  await Promise.all([
    writeFile(
      path.join(runDirectory, "session.json"),
      JSON.stringify({ status: "completed" })
    ),
    writeFile(
      path.join(runDirectory, "manifest.jsonl"),
      `${manifestContents}\n`
    ),
  ]);
};

describe("camera detection capture run paths", () => {
  let fixture: CaptureRunFixture;

  // prepare one isolated filesystem
  beforeEach(async () => {
    fixture = await createFixture();
  });

  // remove the isolated filesystem
  afterEach(async () => {
    await rm(fixture.root, { force: true, recursive: true });
  });

  // route parameter containment contract
  it("rejects traversal and absolute capture session paths", async () => {
    const outsideRun = path.join(fixture.root, "outside-run");
    await writeCompletedRun(outsideRun);
    const unsafeSessionIds = ["../outside-run", outsideRun];

    // unsafe identifier pass
    for (const sessionId of unsafeSessionIds) {
      await expect(
        stopCameraCaptureRun(fixture.paths.captureRoot, sessionId)
      ).rejects.toThrow();
      await expect(
        deleteCameraCaptureRun(fixture.paths.captureRoot, sessionId)
      ).rejects.toThrow();
      await expect(
        importCameraCaptureRun(fixture.paths, sessionId)
      ).rejects.toThrow();
    }

    await expect(access(outsideRun)).resolves.toBeUndefined();
    await expect(
      access(path.join(outsideRun, ".stop-requested"))
    ).rejects.toThrow();
  });

  // symlink containment contract
  it("rejects capture session symlinks that leave the capture root", async () => {
    const outsideRun = path.join(fixture.root, "outside-run");
    await writeCompletedRun(outsideRun);
    await symlink(
      outsideRun,
      path.join(fixture.paths.captureRoot, "capture-linked-run"),
      "dir"
    );

    await expect(
      stopCameraCaptureRun(fixture.paths.captureRoot, "capture-linked-run")
    ).rejects.toThrow();
    await expect(
      access(path.join(outsideRun, ".stop-requested"))
    ).rejects.toThrow();
  });

  // manifest path containment contract
  it("ignores traversal and absolute frame paths during import", async () => {
    const sessionId = "capture-path-test";
    const runDirectory = path.join(fixture.paths.captureRoot, sessionId);
    const outsideFrame = path.join(fixture.root, "outside.jpg");
    const storedRecord = {
      cameraId: "camera-one",
      cameraName: "Camera one",
      capturedAt: "2026-08-11T12:00:00.000Z",
      contentType: "image/jpeg",
      frameSize: { height: 100, width: 100 },
      sha256: "safe-frame-sha",
      sourceImageUrl: "https://example.test/camera.jpg",
      status: "stored",
    };
    await writeCompletedRun(runDirectory, [
      { ...storedRecord, file: "frames/..", sha256: "traversal-sha" },
      { ...storedRecord, file: outsideFrame, sha256: "absolute-sha" },
      { ...storedRecord, file: "frames/captured.jpg" },
    ]);
    await Promise.all([
      writeFile(outsideFrame, "outside-frame"),
      writeFile(path.join(runDirectory, "frames/captured.jpg"), "safe-frame"),
    ]);

    await expect(
      importCameraCaptureRun(fixture.paths, sessionId)
    ).resolves.toBe(1);
    expect(await readFile(outsideFrame, "utf8")).toBe("outside-frame");
    const manifest = JSON.parse(
      await readFile(fixture.paths.benchmarkManifestFile, "utf8")
    ) as { frames: Array<{ sha256: string }> };
    // imported digest projection
    expect(manifest.frames.map((frame) => frame.sha256)).toEqual([
      "safe-frame-sha",
    ]);
  });

  // stored frame symlink contract
  it("rejects frame symlinks that leave the capture run", async () => {
    const sessionId = "capture-frame-link";
    const runDirectory = path.join(fixture.paths.captureRoot, sessionId);
    const outsideFrame = path.join(fixture.root, "outside.jpg");
    await writeCompletedRun(runDirectory, [
      {
        cameraId: "camera-one",
        cameraName: "Camera one",
        capturedAt: "2026-08-11T12:00:00.000Z",
        contentType: "image/jpeg",
        file: "frames/captured.jpg",
        frameSize: { height: 100, width: 100 },
        sha256: "linked-frame-sha",
        sourceImageUrl: "https://example.test/camera.jpg",
        status: "stored",
      },
    ]);
    await writeFile(outsideFrame, "outside-frame");
    await symlink(
      outsideFrame,
      path.join(runDirectory, "frames/captured.jpg"),
      "file"
    );

    await expect(
      importCameraCaptureRun(fixture.paths, sessionId)
    ).rejects.toThrow();
    expect(await readFile(outsideFrame, "utf8")).toBe("outside-frame");
  });
});
