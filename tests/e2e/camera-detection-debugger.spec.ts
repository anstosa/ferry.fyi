import fs from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

const repositoryRoot = process.cwd();
const benchmarkRoot = path.join(repositoryRoot, "benchmarks/camera-detection");
const cameraConfig = fs.readFileSync(
  path.join(repositoryRoot, "shared/data/camera-detection-areas.json")
);
const cameraOverrides = fs.readFileSync(
  path.join(repositoryRoot, "shared/data/cameras.json")
);
const benchmarkManifest = JSON.parse(
  fs.readFileSync(path.join(benchmarkRoot, "manifest.json"), "utf8")
) as {
  frames: Array<{ file: string }>;
};

type SavedLabels = {
  frames?: Record<
    string,
    { areaStates?: Record<string, string>; cameraId?: string }
  >;
};

type CaptureRunRequest = {
  cameraIds?: string[];
  durationSeconds?: number;
  imageLimit?: number;
  intervalSeconds?: number;
};

type SaveControl = {
  failNext: boolean;
};

// install deterministic debugger routes
const installDebuggerFixtures = async (
  page: Page,
  savedPayloads: SavedLabels[],
  captureRequests: CaptureRunRequest[],
  saveControl: SaveControl = { failNext: false }
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
        body: JSON.stringify({
          frames: {},
          schemaVersion: 1,
          updatedAt: null,
        }),
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
      // requested save failure
      if (saveControl.failNext) {
        saveControl.failNext = false;
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
    await canvas.scrollIntoViewIfNeeded();
    const touchPoint = await page.evaluate(() => {
      const canvasElement = document.querySelector<HTMLCanvasElement>("#canvas");
      const labeler = document.querySelector<HTMLElement>("#benchmarkLabeler");
      // visible canvas guard
      if (!canvasElement || !labeler) return null;
      const canvasBox = canvasElement.getBoundingClientRect();
      const labelerBox = labeler.getBoundingClientRect();
      const visibleTop = Math.max(0, canvasBox.top) + 20;
      const visibleBottom = Math.min(
        window.innerHeight,
        canvasBox.bottom,
        labelerBox.top
      ) - 20;
      return {
        x: canvasBox.left + canvasBox.width / 2,
        y: (visibleTop + visibleBottom) / 2,
      };
    });
    expect(touchPoint).not.toBeNull();
    const beforeZoom = await page.locator("#zoomStatus").textContent();
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
    await expect(page.locator("#zoomStatus")).not.toHaveText(beforeZoom ?? "");
  } finally {
    await context.close();
  }
});

// failed label persistence contract
test("keeps a failed benchmark label focused for retry", async ({ page }) => {
  const savedPayloads: SavedLabels[] = [];
  const captureRequests: CaptureRunRequest[] = [];
  const saveControl = { failNext: true };
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
});
