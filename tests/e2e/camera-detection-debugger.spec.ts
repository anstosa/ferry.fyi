import fs from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import {
  CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_ATTEMPT_KEY,
  CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_REFRESHED_KEY,
  CAMERA_DETECTION_DEBUGGER_TOKEN_KEY,
} from "../../client/lib/cameraDetectionDebugger";

const repositoryRoot = process.cwd();
const benchmarkDraftStorageKey =
  "ferry-fyi-dev-camera-detection-benchmark-draft";
const benchmarkRoot = path.join(repositoryRoot, "benchmarks/camera-detection");
const cameraConfig = fs.readFileSync(
  path.join(repositoryRoot, "shared/data/camera-detection-areas.json")
);
const cameraOverrides = fs.readFileSync(
  path.join(repositoryRoot, "shared/data/cameras.json")
);
const cameraDetectionAreas = JSON.parse(cameraConfig.toString("utf8")) as {
  cameras: Record<string, { allowedAreas: Array<{ id: string }> }>;
};
const benchmarkManifest = JSON.parse(
  fs.readFileSync(path.join(benchmarkRoot, "manifest.json"), "utf8")
) as {
  frames: Array<{
    cameraId: string;
    file: string;
    frameId: string;
    role: "control" | "test";
  }>;
};

type SavedLabels = {
  frames?: Record<
    string,
    { areaStates?: Record<string, string>; cameraId?: string; notes?: string }
  >;
};

type CaptureRunRequest = {
  cameraIds?: string[];
  durationSeconds?: number;
  imageLimit?: number;
  intervalSeconds?: number;
};

type SaveControl = {
  authorizationDenialsRemaining?: number;
  authorizationFailuresRemaining?: number;
  delayMs?: number;
  failuresRemaining: number;
};

// build completed labels for one frame role
const completedLabelsForRole = (role: "control" | "test"): SavedLabels => {
  const frames: NonNullable<SavedLabels["frames"]> = {};
  // selected role pass
  for (const frame of benchmarkManifest.frames.filter(
    (candidate) => candidate.role === role
  )) {
    const areas =
      cameraDetectionAreas.cameras[frame.cameraId]?.allowedAreas ?? [];
    const areaStates: Record<string, string> = {};
    // completed area pass
    for (const area of areas) {
      areaStates[area.id] = "empty";
    }
    frames[frame.frameId] = {
      areaStates,
      cameraId: frame.cameraId,
      notes: "",
    };
  }
  return { frames };
};

// install deterministic debugger routes
const installDebuggerFixtures = async (
  page: Page,
  savedPayloads: SavedLabels[],
  captureRequests: CaptureRunRequest[],
  saveControl: SaveControl = { failuresRemaining: 0 },
  initialLabels: SavedLabels = { frames: {} }
): Promise<void> => {
  await page.route(
    "**/api/debug/camera-detection/camera-detection-areas.json*",
    async (route) => {
      await route.fulfill({
        body: cameraConfig,
        contentType: "application/json",
        status: 200,
      });
    }
  );
  await page.route(
    "**/api/debug/camera-detection/camera-display-overrides.json*",
    async (route) => {
      await route.fulfill({
        body: cameraOverrides,
        contentType: "application/json",
        status: 200,
      });
    }
  );
  await page.route(
    "**/api/debug/camera-detection/camera-benchmark.json*",
    async (route) => {
      await route.fulfill({
        body: JSON.stringify(benchmarkManifest),
        contentType: "application/json",
        status: 200,
      });
    }
  );
  await page.route(
    "**/api/debug/camera-detection/camera-benchmark-labels.json*",
    async (route) => {
      await route.fulfill({
        body: JSON.stringify(initialLabels),
        contentType: "application/json",
        status: 200,
      });
    }
  );
  await page.route(
    "**/api/debug/camera-detection/camera-benchmark-frame/*",
    async (route) => {
      const fileName = path.basename(new URL(route.request().url()).pathname);
      const frame = benchmarkManifest.frames.find(
        (candidate) => path.basename(candidate.file) === fileName
      );
      // known frame guard
      if (!frame) {
        await route.fulfill({ status: 404 });
        return;
      }
      await route.fulfill({
        body: fs.readFileSync(path.join(benchmarkRoot, frame.file)),
        contentType: fileName.endsWith(".png") ? "image/png" : "image/jpeg",
        status: 200,
      });
    }
  );
  await page.route(
    "**/api/debug/camera-detection/capture-runs*",
    async (route) => {
      await route.fulfill({
        body: "[]",
        contentType: "application/json",
        status: 200,
      });
    }
  );
  await page.route(
    "**/api/admin/camera-detection/capture-runs",
    async (route) => {
      captureRequests.push(route.request().postDataJSON() as CaptureRunRequest);
      await route.fulfill({
        body: JSON.stringify({ sessionId: "capture-browser-test" }),
        contentType: "application/json",
        status: 202,
      });
    }
  );
  await page.route(
    "**/api/admin/camera-detection/save-benchmark-labels",
    async (route) => {
      savedPayloads.push(route.request().postDataJSON() as SavedLabels);
      // requested response delay
      if (saveControl.delayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, saveControl.delayMs)
        );
      }
      const authorizationFailures =
        saveControl.authorizationFailuresRemaining ?? 0;
      const authorizationDenials =
        saveControl.authorizationDenialsRemaining ?? 0;
      // requested owner denial
      if (authorizationDenials > 0) {
        saveControl.authorizationDenialsRemaining = authorizationDenials - 1;
        await route.fulfill({
          body: JSON.stringify({
            body: { error: "Administrator access required" },
            wsfStatus: { offline: false },
          }),
          contentType: "application/json",
          status: 403,
        });
        return;
      }
      // requested authorization failure
      if (authorizationFailures > 0) {
        saveControl.authorizationFailuresRemaining = authorizationFailures - 1;
        await route.fulfill({
          body: JSON.stringify({
            body: { error: "unauthorized" },
            wsfStatus: { offline: false },
          }),
          contentType: "application/json",
          status: 401,
        });
        return;
      }
      // requested save failure
      if (saveControl.failuresRemaining > 0) {
        saveControl.failuresRemaining -= 1;
        await route.fulfill({
          body: JSON.stringify({ error: "Fixture save failed" }),
          contentType: "application/json",
          status: 500,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify({ ok: true }),
        contentType: "application/json",
        status: 200,
      });
    }
  );
};

// track labeling canvas output
const trackLabelingCanvasOutput = async (page: Page): Promise<void> => {
  // install before application scripts
  await page.addInitScript(() => {
    const context = CanvasRenderingContext2D.prototype;
    const originalBeginPath = context.beginPath;
    const originalClosePath = context.closePath;
    const originalFill = context.fill;
    const originalFillText = context.fillText;
    const originalLineTo = context.lineTo;
    const trackedWindow = window as typeof window & {
      __canvasLabelCount?: number;
      __closedPolygonFillCount?: number;
      __visiblePolygonStrokeColors?: string[];
    };
    let pathClosed = false;
    let pathHasLine = false;
    trackedWindow.__canvasLabelCount = 0;
    trackedWindow.__closedPolygonFillCount = 0;
    trackedWindow.__visiblePolygonStrokeColors = [];
    const originalClearRect = context.clearRect;
    const originalStroke = context.stroke;
    // reset visible polygon tracking
    context.clearRect = function (...args) {
      trackedWindow.__visiblePolygonStrokeColors = [];
      return Reflect.apply(originalClearRect, this, args);
    };
    // reset path tracking
    context.beginPath = function () {
      pathClosed = false;
      pathHasLine = false;
      return originalBeginPath.call(this);
    };
    // track polygon edges
    context.lineTo = function (x, y) {
      pathHasLine = true;
      return originalLineTo.call(this, x, y);
    };
    // track closed paths
    context.closePath = function () {
      pathClosed = true;
      return originalClosePath.call(this);
    };
    // track visible polygon borders
    context.stroke = function (
      this: CanvasRenderingContext2D,
      ...args: [] | [Path2D]
    ) {
      trackedWindow.__visiblePolygonStrokeColors?.push(
        String(this.strokeStyle)
      );
      return Reflect.apply(originalStroke, this, args);
    } as CanvasRenderingContext2D["stroke"];
    // count shaded polygons
    context.fill = function (
      this: CanvasRenderingContext2D,
      ...args: [] | [Path2D, CanvasFillRule?]
    ) {
      // closed polygon guard
      if (pathClosed && pathHasLine) {
        trackedWindow.__closedPolygonFillCount =
          (trackedWindow.__closedPolygonFillCount ?? 0) + 1;
      }
      return Reflect.apply(originalFill, this, args);
    } as CanvasRenderingContext2D["fill"];
    // count canvas labels
    context.fillText = function (...args) {
      trackedWindow.__canvasLabelCount =
        (trackedWindow.__canvasLabelCount ?? 0) + 1;
      return Reflect.apply(originalFillText, this, args);
    };
  });
};

// default debugger route contract
test("opens benchmark labels by default and preserves the editor route", async ({
  page,
}) => {
  await installDebuggerFixtures(page, [], []);

  await page.goto("/dev/camera-detection", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("body")).toHaveAttribute(
    "data-tool-mode",
    "benchmark"
  );
  await expect(page.locator('a[data-mode="editor"]')).toHaveAttribute(
    "href",
    "/dev/camera-detection/editor"
  );

  await page.goto("/dev/camera-detection/editor", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("body")).toHaveAttribute(
    "data-tool-mode",
    "editor"
  );
  await expect(page.locator("#zoomOutBtn + #zoomInBtn")).toHaveCount(1);
  await expect(page.locator("#zoomActualBtn")).toHaveCount(0);
  await expect(page.locator("#zoomStatus")).toHaveCount(0);
  await expect(page.locator("#panBtn")).toHaveCount(0);
  await expect(page.locator("#hidePolygonsBtn")).toHaveCount(0);
  await expect(page.locator("#polygonVisibilityBtn")).toBeHidden();
});

// benchmark polygon visibility contract
test("blinks only the active polygon border while labeling", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-08-14T12:00:00-07:00") });
  await trackLabelingCanvasOutput(page);
  await installDebuggerFixtures(page, [], []);

  await page.goto("/dev/camera-detection/benchmarks", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#benchmarkStatus")).toContainText(/loaded/i);
  await page.getByRole("button", { name: "Tests" }).click();
  await page
    .locator("#benchmarkFrame")
    .selectOption("test-mukilteo-holding-001");
  await expect(page.locator(".benchmark-target-label")).toHaveCount(0);
  await expect(page.locator("#benchmarkTargetMeta")).not.toContainText(
    /left in (image|set)/i
  );
  await expect(page.locator("#benchmarkTargetName")).toHaveText("Lane 7");
  await expect(page.locator("#benchmarkTargetMeta")).not.toContainText(
    /unlabeled|holding_lane/i
  );
  await expect(page.locator("#benchmarkLabeler")).not.toContainText(
    "mukilteo_mukilteo_holding_holding_lane_7"
  );
  const stateSegments = page.getByRole("group", { name: "Occupancy label" });
  await expect(stateSegments.getByRole("button")).toHaveCount(4);
  await expect(
    stateSegments.getByRole("button", { name: "Sparse" })
  ).toHaveCount(1);
  await expect(
    stateSegments.getByRole("button", { name: "Crowded" })
  ).toHaveCount(1);
  // inspect the rendered state segments
  const segmentLayout = await stateSegments.evaluate((element) => {
    const buttons = element.querySelectorAll("button");
    const firstButtonRect = buttons[0].getBoundingClientRect();
    const secondButtonRect = buttons[1].getBoundingClientRect();
    const containerStyle = getComputedStyle(element);
    const firstButtonStyle = getComputedStyle(buttons[0]);
    const secondButtonStyle = getComputedStyle(buttons[1]);
    return {
      backgroundColor: containerStyle.backgroundColor,
      borderWidth: containerStyle.borderWidth,
      columnCount: containerStyle.gridTemplateColumns.split(" ").length,
      firstGap: secondButtonRect.left - firstButtonRect.right,
      firstInsideRadius: firstButtonStyle.borderTopRightRadius,
      paddingLeft: containerStyle.paddingLeft,
      secondOutsideRadius: secondButtonStyle.borderTopLeftRadius,
      segmentHeight: firstButtonRect.height,
    };
  });
  expect(segmentLayout).toMatchObject({
    backgroundColor: "rgba(0, 0, 0, 0)",
    borderWidth: "0px",
    columnCount: 4,
    firstGap: 0,
    firstInsideRadius: "0px",
    paddingLeft: "0px",
    secondOutsideRadius: "0px",
    segmentHeight: 32,
  });
  // read visible polygon borders
  const visiblePolygonStrokeColors = (): Promise<string[]> =>
    page.evaluate(
      () =>
        (
          window as typeof window & {
            __visiblePolygonStrokeColors?: string[];
          }
        ).__visiblePolygonStrokeColors ?? []
    );
  await expect.poll(visiblePolygonStrokeColors).toEqual(["#facc15"]);
  await page.clock.runFor(1000);
  await expect.poll(visiblePolygonStrokeColors).toEqual([]);
  await page.clock.runFor(1000);
  await expect.poll(visiblePolygonStrokeColors).toEqual(["#facc15"]);
  const polygonModeButton = page.locator("#polygonVisibilityBtn");
  await expect(polygonModeButton).toHaveText("Blink Poly");
  // inspect the compact image toolbar
  const toolbarLayout = await page
    .locator(".canvas-bar")
    .evaluate((element) => {
      const button = element.querySelector("button");
      const style = getComputedStyle(element);
      return {
        buttonHeight: button?.getBoundingClientRect().height ?? 0,
        height: element.getBoundingClientRect().height,
        paddingBottom: style.paddingBottom,
        paddingTop: style.paddingTop,
      };
    });
  expect(toolbarLayout).toEqual({
    buttonHeight: 26,
    height: 32,
    paddingBottom: "2px",
    paddingTop: "2px",
  });

  await polygonModeButton.click();
  await expect(polygonModeButton).toHaveText("Hide Poly");
  await expect.poll(visiblePolygonStrokeColors).toEqual([]);
  await page.clock.runFor(1500);
  await expect.poll(visiblePolygonStrokeColors).toEqual([]);

  await polygonModeButton.click();
  await expect(polygonModeButton).toHaveText("Show Poly");
  await expect.poll(visiblePolygonStrokeColors).toEqual(["#facc15"]);
  await page.clock.runFor(1500);
  await expect.poll(visiblePolygonStrokeColors).toEqual(["#facc15"]);

  await polygonModeButton.click();
  await expect(polygonModeButton).toHaveText("Blink Poly");
  await expect.poll(visiblePolygonStrokeColors).toEqual(["#facc15"]);
  await page.clock.runFor(1000);
  await expect.poll(visiblePolygonStrokeColors).toEqual([]);
  await page.clock.runFor(1000);
  await expect.poll(visiblePolygonStrokeColors).toEqual(["#facc15"]);

  await page.clock.runFor(900);
  const firstTarget = await page.locator("#benchmarkTargetName").textContent();
  await page
    .locator("#benchmarkQuickStates")
    .getByRole("button", { name: "Empty", exact: true })
    .click();
  await expect(page.locator("#benchmarkTargetName")).not.toHaveText(
    firstTarget ?? ""
  );
  await page.clock.runFor(200);
  await expect.poll(visiblePolygonStrokeColors).toEqual(["#facc15"]);
  await page.clock.runFor(800);
  await expect.poll(visiblePolygonStrokeColors).toEqual([]);
  await expect
    .poll(
      // read tracked fills
      () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __closedPolygonFillCount?: number;
              }
            ).__closedPolygonFillCount ?? 0
        )
    )
    .toBe(0);
  await expect
    .poll(
      // read tracked labels
      () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __canvasLabelCount?: number;
              }
            ).__canvasLabelCount ?? 0
        )
    )
    .toBe(0);
});

// benchmark keyboard shortcut contract
test("labels and navigates benchmark polygons with keyboard shortcuts", async ({
  page,
}) => {
  const savedPayloads: SavedLabels[] = [];
  await installDebuggerFixtures(page, savedPayloads, []);

  await page.goto("/dev/camera-detection/benchmarks", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#benchmarkStatus")).toContainText(/loaded/i);
  await page.getByRole("button", { name: "Tests" }).click();
  await page.locator("#benchmarkFrameControl").click();
  await page
    .locator('#benchmarkFrameMenu [data-value="test-mukilteo-holding-001"]')
    .click();
  const targetName = page.locator("#benchmarkTargetName");
  await expect(targetName).toHaveText("Lane 7");
  await expect(page.locator("#benchmarkFrameControl")).toBeFocused();
  const labelHints = [
    {
      descriptionId: "benchmarkShortcut1Description",
      label: "Empty",
      shortcut: "1",
    },
    {
      descriptionId: "benchmarkShortcut2Description",
      label: "Sparse",
      shortcut: "2",
    },
    {
      descriptionId: "benchmarkShortcut3Description",
      label: "Crowded",
      shortcut: "3",
    },
    {
      descriptionId: "benchmarkShortcut4Description",
      label: "Full",
      shortcut: "4",
    },
  ];
  // visible label shortcut pass
  for (const hint of labelHints) {
    const button = page.getByRole("button", {
      name: hint.label,
      exact: true,
    });
    await expect(button).toHaveAttribute(
      "aria-describedby",
      hint.descriptionId
    );
    await expect(button).toHaveAttribute("aria-keyshortcuts", hint.shortcut);
    await expect(button.locator(".shortcut-keycap")).toBeVisible();
    await expect(button.locator(".shortcut-keycap")).toHaveText(hint.shortcut);
    await expect(page.locator(`#${hint.descriptionId}`)).toContainText(
      `Keyboard shortcut: ${hint.shortcut}.`
    );
  }
  const skipPolygonButton = page.getByRole("button", {
    name: "Skip polygon",
    exact: true,
  });
  await expect(skipPolygonButton).toHaveAttribute(
    "aria-keyshortcuts",
    "ArrowRight"
  );
  await expect(skipPolygonButton).toHaveAttribute(
    "aria-describedby",
    "skipBenchmarkPolygonShortcutDescription"
  );
  await expect(skipPolygonButton.locator(".shortcut-keycap")).toHaveText("→");
  const skipFrameButton = page.getByRole("button", {
    name: "Skip frame",
    exact: true,
  });
  await expect(skipFrameButton).toHaveAttribute(
    "aria-keyshortcuts",
    "Control+ArrowRight"
  );
  await expect(skipFrameButton).toHaveAttribute(
    "aria-describedby",
    "skipBenchmarkFrameShortcutDescription"
  );
  await expect(skipFrameButton.locator(".shortcut-keycap")).toHaveText([
    "Ctrl",
    "→",
  ]);
  await page.keyboard.press("ArrowRight");
  await expect(targetName).toHaveText("Lane 6");
  await page.keyboard.press("ArrowLeft");
  await expect(targetName).toHaveText("Lane 7");

  const shortcuts = [
    { key: "1", nextLabel: "Lane 6" },
    { key: "2", nextLabel: "Lane 5" },
    { key: "3", nextLabel: "Lane 4" },
    { key: "4", nextLabel: "Lane 3" },
  ];
  // keyboard label pass
  for (const [index, shortcut] of shortcuts.entries()) {
    await page.keyboard.press(shortcut.key);
    await expect.poll(() => savedPayloads.length).toBe(index + 1);
    await expect(targetName).toHaveText(shortcut.nextLabel);
  }
  expect(
    savedPayloads.at(-1)?.frames?.["test-mukilteo-holding-001"]?.areaStates
  ).toMatchObject({
    mukilteo_mukilteo_holding_holding_lane_4: "full",
    mukilteo_mukilteo_holding_holding_lane_5: "majority_full",
    mukilteo_mukilteo_holding_holding_lane_6: "minority_full",
    mukilteo_mukilteo_holding_holding_lane_7: "empty",
  });

  await page.keyboard.press("ArrowLeft");
  await expect(targetName).toHaveText("Lane 4");
  await page.keyboard.press("ArrowRight");
  await expect(targetName).toHaveText("Lane 3");

  await page.getByText("Frame notes", { exact: true }).click();
  await page.locator("#benchmarkNotes").focus();
  await expect(page.locator("#benchmarkNotes")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(targetName).toHaveText("Lane 3");
  expect(savedPayloads).toHaveLength(4);
  // release text input focus
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  const currentFrame = await page.locator("#benchmarkFrame").inputValue();
  await page.keyboard.press("Control+ArrowRight");
  await expect(page.locator("#benchmarkFrame")).not.toHaveValue(currentFrame);
});

// image viewport reset contract
test("resets zoom and pan when the benchmark image changes", async ({
  page,
}) => {
  await installDebuggerFixtures(page, [], []);

  await page.goto("/dev/camera-detection/benchmarks", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#benchmarkStatus")).toContainText(/loaded/i);
  await page.getByRole("button", { name: "Tests" }).click();
  await page.locator("#benchmarkFrame").selectOption("test-clover-lane-001");
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  // reach a scrollable zoom level
  for (let clickIndex = 0; clickIndex < 5; clickIndex += 1) {
    await zoomIn.click();
  }
  const viewport = page.locator(".canvas-viewport");
  // seed a non-default pan position
  await viewport.evaluate((element) => {
    element.scrollLeft = 120;
    element.scrollTop = 120;
  });
  await expect
    .poll(
      // read the zoomed and panned view
      () =>
        page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
          const imageViewport =
            document.querySelector<HTMLElement>(".canvas-viewport");
          // rendered viewport guard
          if (!canvas || !imageViewport) {
            return null;
          }
          return {
            panLeft: imageViewport.scrollLeft,
            panTop: imageViewport.scrollTop,
            scale: Number.parseFloat(canvas.style.width) / canvas.width,
          };
        })
    )
    .toMatchObject({ panLeft: 120, panTop: 120, scale: 4 });

  await page
    .locator("#benchmarkFrame")
    .selectOption("test-mukilteo-holding-001");
  await expect
    .poll(
      // read the reset image view
      () =>
        page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
          const imageViewport =
            document.querySelector<HTMLElement>(".canvas-viewport");
          // rendered viewport guard
          if (!canvas || !imageViewport) {
            return null;
          }
          return {
            panLeft: imageViewport.scrollLeft,
            panTop: imageViewport.scrollTop,
            scale: Number.parseFloat(canvas.style.width) / canvas.width,
          };
        })
    )
    .toEqual({ panLeft: 0, panTop: 0, scale: 1 });
});

// centered zoom contract
test("zooms around the visible image center", async ({ page }) => {
  await installDebuggerFixtures(page, [], []);

  await page.goto("/dev/camera-detection/benchmarks", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#benchmarkStatus")).toContainText(/loaded/i);
  await page.getByRole("button", { name: "Tests" }).click();
  await page.locator("#benchmarkFrame").selectOption("test-clover-lane-001");
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  // reach a pannable zoom level
  for (let clickIndex = 0; clickIndex < 3; clickIndex += 1) {
    await zoomIn.click();
  }
  const viewport = page.locator(".canvas-viewport");
  // move away from the image origin
  await viewport.evaluate((element) => {
    element.scrollLeft = element.scrollWidth * 0.2;
    element.scrollTop = element.scrollHeight * 0.2;
  });
  // read the visible image center
  const readVisibleImageCenter = (): Promise<{ x: number; y: number } | null> =>
    page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
      const imageViewport =
        document.querySelector<HTMLElement>(".canvas-viewport");
      // rendered viewport guard
      if (!canvas || !imageViewport) {
        return null;
      }
      const canvasRect = canvas.getBoundingClientRect();
      const viewportRect = imageViewport.getBoundingClientRect();
      const centerX =
        (Math.max(canvasRect.left, viewportRect.left) +
          Math.min(canvasRect.right, viewportRect.right)) /
        2;
      const centerY =
        (Math.max(canvasRect.top, viewportRect.top) +
          Math.min(canvasRect.bottom, viewportRect.bottom)) /
        2;
      return {
        x: (centerX - canvasRect.left) / canvasRect.width,
        y: (centerY - canvasRect.top) / canvasRect.height,
      };
    });
  const beforeCenter = await readVisibleImageCenter();

  await zoomIn.click();

  const afterCenter = await readVisibleImageCenter();
  expect(beforeCenter).not.toBeNull();
  expect(afterCenter).not.toBeNull();
  expect(afterCenter!.x).toBeCloseTo(beforeCenter!.x, 2);
  expect(afterCenter!.y).toBeCloseTo(beforeCenter!.y, 2);
});

// fit viewport contract
test("fits the full image without viewport scrollbars", async ({ page }) => {
  await installDebuggerFixtures(page, [], []);

  await page.goto("/dev/camera-detection/benchmarks", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#benchmarkStatus")).toContainText(/loaded/i);
  await page.getByRole("button", { name: "Tests" }).click();
  await page.locator("#benchmarkFrame").selectOption("test-clover-lane-001");
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  // force both viewport axes to overflow
  for (let clickIndex = 0; clickIndex < 5; clickIndex += 1) {
    await zoomIn.click();
  }
  const viewport = page.locator(".canvas-viewport");
  await expect
    .poll(
      // read the overflowing viewport
      () =>
        viewport.evaluate((element) => ({
          horizontal: element.scrollWidth > element.clientWidth,
          vertical: element.scrollHeight > element.clientHeight,
        }))
    )
    .toEqual({ horizontal: true, vertical: true });

  await page.getByRole("button", { name: "Fit" }).click();

  await expect
    .poll(
      // read the fitted viewport
      () =>
        viewport.evaluate((element) => {
          const canvas = element.querySelector("canvas");
          // fitted canvas guard
          if (!canvas) {
            return null;
          }
          return {
            horizontalOverflow: Math.max(
              0,
              element.scrollWidth - element.clientWidth
            ),
            verticalOverflow: Math.max(
              0,
              element.scrollHeight - element.clientHeight
            ),
          };
        })
    )
    .toMatchObject({ horizontalOverflow: 0, verticalOverflow: 0 });
  const imageWidthRatio = await viewport.evaluate((element) => {
    const canvas = element.querySelector("canvas");
    return canvas
      ? canvas.getBoundingClientRect().width / element.clientWidth
      : 0;
  });
  expect(imageWidthRatio).toBeGreaterThan(0.98);
});

// compact benchmark spacing contract
test("uses compact gutters and one standard gap above the label dock", async ({
  page,
}) => {
  await page.setViewportSize({ height: 477, width: 482 });
  await installDebuggerFixtures(page, [], []);

  await page.goto("/dev/camera-detection/benchmarks", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#benchmarkStatus")).toContainText(/loaded/i);
  await page.getByRole("button", { name: "Tests" }).click();
  await page.locator("#benchmarkFrame").selectOption("test-clover-lane-001");
  await expect(
    page
      .locator("#benchmarkQuickStates")
      .getByRole("button", { exact: true, name: "Empty" })
  ).toBeEnabled();
  // reach the page bottom
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });

  await expect
    .poll(
      // read the final benchmark spacing
      () =>
        page.evaluate(() => {
          const canvasShell =
            document.querySelector<HTMLElement>(".canvas-shell");
          const labeler =
            document.querySelector<HTMLElement>("#benchmarkLabeler");
          const section = document.querySelector<HTMLElement>("section");
          const imageViewport =
            canvasShell?.querySelector<HTMLElement>(".canvas-viewport");
          const canvasWrap =
            canvasShell?.querySelector<HTMLElement>(".canvas-wrap");
          // rendered layout guard
          if (
            !canvasShell ||
            !labeler ||
            !section ||
            !imageViewport ||
            !canvasWrap
          ) {
            return null;
          }
          const canvasRect = canvasShell.getBoundingClientRect();
          const labelerRect = labeler.getBoundingClientRect();
          const sectionRect = section.getBoundingClientRect();
          const viewportStyle = getComputedStyle(imageViewport);
          const wrapStyle = getComputedStyle(canvasWrap);
          return {
            canvasBorderLeft: getComputedStyle(canvasShell).borderLeftWidth,
            canvasBorderRight: getComputedStyle(canvasShell).borderRightWidth,
            dockBottom: Math.round(window.innerHeight - labelerRect.bottom),
            dockGap: Math.round(labelerRect.top - canvasRect.bottom),
            labelerLeft: Math.round(labelerRect.left - canvasRect.left),
            labelerRight: Math.round(canvasRect.right - labelerRect.right),
            leftGutter: Math.round(canvasRect.left - sectionRect.left),
            rightGutter: Math.round(sectionRect.right - canvasRect.right),
            viewportPaddingLeft: viewportStyle.paddingLeft,
            viewportPaddingRight: viewportStyle.paddingRight,
            wrapBorderLeft: wrapStyle.borderLeftWidth,
            wrapBorderRight: wrapStyle.borderRightWidth,
          };
        })
    )
    .toEqual({
      canvasBorderLeft: "0px",
      canvasBorderRight: "0px",
      dockBottom: 8,
      dockGap: 9,
      labelerLeft: 8,
      labelerRight: 8,
      leftGutter: 0,
      rightGutter: 0,
      viewportPaddingLeft: "0px",
      viewportPaddingRight: "0px",
      wrapBorderLeft: "0px",
      wrapBorderRight: "0px",
    });
});

// deleted polygon recovery contract
test("prunes obsolete polygon labels before saving", async ({ page }) => {
  const savedPayloads: SavedLabels[] = [];
  await installDebuggerFixtures(
    page,
    savedPayloads,
    [],
    { failuresRemaining: 0 },
    {
      frames: {
        "control-clover-lane-empty-001": {
          areaStates: { obsolete_polygon: "empty" },
          cameraId: "9161",
          notes: "",
        },
      },
    }
  );

  await page.goto("/dev/camera-detection/benchmarks", {
    waitUntil: "domcontentloaded",
  });
  const saveButton = page.getByRole("button", { name: "Save now" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect(page.locator("#benchmarkStatus")).toContainText(
    "Benchmark labels saved"
  );
  expect(
    savedPayloads[0]?.frames?.["control-clover-lane-empty-001"]?.areaStates
  ).toEqual({});
});

// accelerated mobile labeling contract
test("autosaves, advances labels, and supports mobile pinch zoom", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4040",
    hasTouch: true,
    isMobile: true,
    viewport: { height: 844, width: 390 },
  });
  const page = await context.newPage();
  const savedPayloads: SavedLabels[] = [];
  const captureRequests: CaptureRunRequest[] = [];
  await installDebuggerFixtures(page, savedPayloads, captureRequests);

  try {
    await page.goto("/dev/camera-detection/benchmarks", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("#benchmarkStatus")).toContainText(/loaded/i);
    await expect(page.locator(".custom-select-trigger")).toHaveCount(4);
    await expect(page.locator('#camera option[value="9161"]')).toHaveAttribute(
      "data-label",
      "Mukilteo: Clover Lane (facing towards)"
    );
    await page.getByRole("button", { name: "Controls" }).click();
    await expect(
      page.locator(
        '#benchmarkFrame option[value="control-clover-lane-empty-001"]'
      )
    ).toHaveAttribute("data-label", "Clover Lane (facing towards)");
    const benchmarkDropdown = page.locator("#benchmarkFrameControl");
    await benchmarkDropdown.focus();
    await benchmarkDropdown.press("ArrowDown");
    await expect(page.locator("#benchmarkFrameMenu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(benchmarkDropdown).toBeFocused();
    await page.getByRole("button", { name: "Open inspector" }).click();
    await expect(page.locator("#controlsPanel")).toHaveAttribute(
      "aria-modal",
      "true"
    );
    await page.locator("#inspectorCloseButton").click();
    await expect(
      page.getByRole("button", { name: "Open inspector" })
    ).toBeFocused();
    await page.goto("/dev/camera-detection/capture", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("#capturePanel")).toBeVisible();
    await expect(page.locator("#captureImageLimit")).toHaveValue("6");
    await page.locator("#captureImageLimit").fill("12");
    await expect(page.locator("#captureTimeLimit")).toHaveValue("120");
    await page.locator("#captureTimeLimit").fill("30");
    await expect(page.locator("#captureInterval")).toHaveValue("2.5");
    await page
      .locator("#capturePanel")
      .getByRole("button", { name: "Clear", exact: true })
      .click();
    const firstCaptureCamera = page.locator("#captureCameraList input").first();
    await firstCaptureCamera.check();
    await page.locator("#captureSessionId").fill("capture-browser-test");
    await page.getByRole("button", { name: "Start capture run" }).click();
    await expect.poll(() => captureRequests.length).toBe(1);
    expect(captureRequests[0]).toMatchObject({
      cameraIds: [await firstCaptureCamera.inputValue()],
      durationSeconds: 1_800,
      imageLimit: 12,
      intervalSeconds: 150,
    });
    await page.goto("/dev/camera-detection/benchmarks", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("#benchmarkStatus")).toContainText(/loaded/i);
    await page.getByRole("button", { name: "Tests" }).click();
    await page.locator("#benchmarkFrameControl").click();
    await page
      .locator('#benchmarkFrameMenu [data-value="test-mukilteo-holding-001"]')
      .click();
    await expect(page.locator("#benchmarkFrame")).toHaveValue(
      "test-mukilteo-holding-001"
    );
    // compare rendered image geometry
    const imageAreaRatios = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
      const imageArea = document.querySelector<HTMLElement>(".canvas-viewport");
      // fixture rendering guard
      if (!canvas || !imageArea || !canvas.height || !canvas.width) {
        return null;
      }
      const imageAreaBox = imageArea.getBoundingClientRect();
      return {
        image: canvas.width / canvas.height,
        imageArea: imageAreaBox.width / imageAreaBox.height,
      };
    });
    expect(imageAreaRatios).not.toBeNull();
    expect(imageAreaRatios!.imageArea).toBeCloseTo(imageAreaRatios!.image, 2);

    const firstArea = await page.locator("#benchmarkTargetName").textContent();
    await page
      .locator("#benchmarkQuickStates")
      .getByRole("button", { name: "Empty", exact: true })
      .click();
    await expect(page.locator("#benchmarkStatus")).toContainText("saved");
    await expect(page.locator("#benchmarkFrame")).toHaveValue(
      "test-mukilteo-holding-001"
    );
    await expect(page.locator("#benchmarkTargetName")).not.toHaveText(
      firstArea ?? ""
    );

    await page.locator("#benchmarkFrame").selectOption("test-clover-lane-001");
    await page
      .locator("#benchmarkQuickStates")
      .getByRole("button", { name: "Empty", exact: true })
      .click();
    await expect(page.locator("#benchmarkFrame")).not.toHaveValue(
      "test-clover-lane-001"
    );
    expect(savedPayloads).toHaveLength(2);
    expect(
      Object.values(
        savedPayloads.at(-1)?.frames?.["test-mukilteo-holding-001"]
          ?.areaStates ?? {}
      )
    ).toContain("empty");
    expect(
      savedPayloads.at(-1)?.frames?.["test-clover-lane-001"]?.areaStates
    ).toBeDefined();

    const canvas = page.locator("#canvas");
    await canvas.evaluate((element) => {
      element.scrollIntoView({ block: "start", inline: "center" });
      window.scrollBy(0, -12);
    });
    const touchPoint = await page.evaluate(() => {
      const canvasElement =
        document.querySelector<HTMLCanvasElement>("#canvas");
      const labeler = document.querySelector<HTMLElement>("#benchmarkLabeler");
      // visible canvas guard
      if (!canvasElement || !labeler) {
        return null;
      }
      const canvasBox = canvasElement.getBoundingClientRect();
      const labelerBox = labeler.getBoundingClientRect();
      const visibleTop = Math.max(0, canvasBox.top) + 20;
      const visibleBottom =
        Math.min(window.innerHeight, canvasBox.bottom, labelerBox.top) - 20;
      return {
        x: canvasBox.left + canvasBox.width / 2,
        y: (visibleTop + visibleBottom) / 2,
      };
    });
    expect(touchPoint).not.toBeNull();
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.id,
        touchPoint!
      )
    ).toBe("canvas");
    const beforeCanvasStyle = await canvas.getAttribute("style");
    const centerX = touchPoint!.x;
    const centerY = touchPoint!.y;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      touchPoints: [
        { id: 1, x: centerX - 35, y: centerY },
        { id: 2, x: centerX + 35, y: centerY },
      ],
      type: "touchStart",
    });
    await cdp.send("Input.dispatchTouchEvent", {
      touchPoints: [
        { id: 1, x: centerX - 75, y: centerY },
        { id: 2, x: centerX + 75, y: centerY },
      ],
      type: "touchMove",
    });
    await cdp.send("Input.dispatchTouchEvent", {
      touchPoints: [],
      type: "touchEnd",
    });
    await expect(canvas).not.toHaveAttribute("style", beforeCanvasStyle ?? "");
  } finally {
    await context.close();
  }
});

// sticky save progress contract
test("shows a loading state in the label dock while saving", async ({
  page,
}) => {
  const savedPayloads: SavedLabels[] = [];
  await installDebuggerFixtures(page, savedPayloads, [], {
    delayMs: 500,
    failuresRemaining: 0,
  });

  await page.goto("/dev/camera-detection/benchmarks", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#benchmarkStatus")).toContainText(/loaded/i);
  await page.getByRole("button", { name: "Tests" }).click();
  await page.locator("#benchmarkFrame").selectOption("test-clover-lane-001");
  const labeler = page.locator("#benchmarkLabeler");
  const labelButton = labeler.getByRole("button", {
    exact: true,
    name: "Empty",
  });

  await labelButton.click();

  await expect(labeler).toHaveAttribute("aria-busy", "true");
  await expect(labeler.getByRole("status")).toHaveText("Saving label...");
  await expect(labelButton).toBeDisabled();
  await expect(labeler).toHaveAttribute("aria-busy", "false");
  await expect(labeler.getByRole("status")).toBeHidden();
  expect(savedPayloads).toHaveLength(1);
});

// failed label persistence contract
test("keeps a failed benchmark label focused for retry", async ({ page }) => {
  const savedPayloads: SavedLabels[] = [];
  const captureRequests: CaptureRunRequest[] = [];
  const saveControl = { failuresRemaining: 1 };
  await installDebuggerFixtures(
    page,
    savedPayloads,
    captureRequests,
    saveControl
  );

  await page.goto("/dev/camera-detection/benchmarks", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#benchmarkStatus")).toContainText(/loaded/i);
  await page.getByRole("button", { name: "Tests" }).click();
  await page.locator("#benchmarkFrame").selectOption("test-clover-lane-001");
  const emptyButton = page
    .locator("#benchmarkQuickStates")
    .getByRole("button", { name: "Empty", exact: true });
  await expect(emptyButton).toBeEnabled();
  const targetName = await page.locator("#benchmarkTargetName").textContent();

  await emptyButton.click();

  await expect(page.locator("#benchmarkStatus")).toContainText(
    "Could not save benchmark labels"
  );
  await expect(page.locator("#benchmarkTargetName")).toHaveText(
    targetName ?? ""
  );
  await expect(emptyButton).toHaveAttribute("aria-pressed", "true");
  expect(savedPayloads).toHaveLength(1);

  await page.getByRole("button", { name: "Retry save" }).click();

  await expect(page.locator("#benchmarkStatus")).toContainText(
    "Benchmark labels saved"
  );
  expect(savedPayloads).toHaveLength(2);
  expect(
    Object.values(
      savedPayloads.at(-1)?.frames?.["test-clover-lane-001"]?.areaStates ?? {}
    )
  ).toContain("empty");
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();

  saveControl.failuresRemaining = 1;
  await page.getByText("Frame notes", { exact: true }).click();
  await page.locator("#benchmarkNotes").fill("glare near the holding lane");
  await expect(page.locator("#benchmarkStatus")).toContainText(
    "Could not save benchmark labels"
  );
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.locator("#benchmarkStatus")).toContainText(
    "Benchmark labels saved"
  );
  expect(savedPayloads.at(-1)?.frames?.["test-clover-lane-001"]?.notes).toBe(
    "glare near the holding lane"
  );

  await page.locator("#benchmarkNotes").fill("rain near the holding lane");
  await page.getByRole("button", { name: "Save now" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
  await page.waitForTimeout(500);
  expect(savedPayloads).toHaveLength(5);
});

// automatic authorization recovery contract
test("refreshes expired benchmark save authorization and retries labels", async ({
  page,
}) => {
  const savedPayloads: SavedLabels[] = [];
  const captureRequests: CaptureRunRequest[] = [];
  const unexpectedDialogs: string[] = [];
  // capture interrupted recovery navigation
  page.on("dialog", async (dialog) => {
    unexpectedDialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await installDebuggerFixtures(page, savedPayloads, captureRequests, {
    authorizationFailuresRemaining: 1,
    failuresRemaining: 0,
  });
  // emulate the authenticated app token bridge
  await page.route(
    "**/?authorizeCameraDetectionDebugger=benchmarks",
    async (route) => {
      await route.fulfill({
        body: `<script>
          sessionStorage.setItem(${JSON.stringify(CAMERA_DETECTION_DEBUGGER_TOKEN_KEY)}, "renewed-access-token");
          sessionStorage.setItem(${JSON.stringify(CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_REFRESHED_KEY)}, "true");
          window.location.replace("/dev/camera-detection/benchmarks");
        </script>`,
        contentType: "text/html",
        status: 200,
      });
    }
  );

  await page.goto("/dev/camera-detection/benchmarks", {
    waitUntil: "domcontentloaded",
  });
  // seed one stale debugger credential
  await page.evaluate(
    ([key, value]) => sessionStorage.setItem(key, value),
    [CAMERA_DETECTION_DEBUGGER_TOKEN_KEY, "stale-access-token"]
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#benchmarkStatus")).toContainText(/loaded/i);
  await page.getByRole("button", { name: "Tests" }).click();
  await page.locator("#benchmarkFrame").selectOption("test-clover-lane-001");
  const emptyButton = page
    .locator("#benchmarkQuickStates")
    .getByRole("button", { name: "Empty", exact: true });

  await emptyButton.click();

  await expect(page).toHaveURL(/\/dev\/camera-detection\/benchmarks$/);
  await expect(page.locator("#benchmarkStatus")).toContainText(
    "Benchmark labels saved after authorization refresh"
  );
  // inspect renewed authorization
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      CAMERA_DETECTION_DEBUGGER_TOKEN_KEY
    )
  ).toBe("renewed-access-token");
  // verify recovery state cleanup
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      benchmarkDraftStorageKey
    )
  ).toBeNull();
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_ATTEMPT_KEY
    )
  ).toBeNull();
  expect(unexpectedDialogs).toEqual([]);
  expect(savedPayloads).toHaveLength(2);
});

// owner denial recovery boundary
test("does not relogin after an owner authorization denial", async ({
  page,
}) => {
  const savedPayloads: SavedLabels[] = [];
  await installDebuggerFixtures(page, savedPayloads, [], {
    authorizationDenialsRemaining: 1,
    failuresRemaining: 0,
  });

  await page.goto("/dev/camera-detection/benchmarks", {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate(
    ([key, value]) => sessionStorage.setItem(key, value),
    [CAMERA_DETECTION_DEBUGGER_TOKEN_KEY, "valid-owner-token"]
  );
  await page.getByRole("button", { name: "Tests" }).click();
  await page.locator("#benchmarkFrame").selectOption("test-clover-lane-001");
  await page
    .locator("#benchmarkQuickStates")
    .getByRole("button", { name: "Empty", exact: true })
    .click();

  await expect(page.locator("#benchmarkStatus")).toContainText(
    "Administrator access required"
  );
  await expect(page).toHaveURL(/\/dev\/camera-detection\/benchmarks$/);
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      CAMERA_DETECTION_DEBUGGER_TOKEN_KEY
    )
  ).toBe("valid-owner-token");
  expect(savedPayloads).toHaveLength(1);
});

// completed frame-set navigation contract
test("keeps completed benchmark review inside the selected frame set", async ({
  page,
}) => {
  const savedPayloads: SavedLabels[] = [];
  const captureRequests: CaptureRunRequest[] = [];
  await installDebuggerFixtures(
    page,
    savedPayloads,
    captureRequests,
    { failuresRemaining: 0 },
    completedLabelsForRole("control")
  );

  await page.goto("/dev/camera-detection/benchmarks", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#benchmarkStatus")).toContainText(/loaded/i);
  await page.locator("#benchmarkFrame").selectOption("test-clover-lane-001");
  const controlFrameIds = benchmarkManifest.frames
    .filter((frame) => frame.role === "control")
    .map((frame) => frame.frameId);

  await page.getByRole("button", { name: "Controls" }).click();

  await expect(page.getByRole("button", { name: "Controls" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect(controlFrameIds).toContain(
    await page.locator("#benchmarkFrame").inputValue()
  );
});
