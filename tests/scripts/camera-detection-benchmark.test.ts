import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  cameraDetectionIconCount,
  renderCameraDetectionIconSprite,
} from "../../scripts/camera-polygon-annotator/fontAwesomeIcons";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const benchmarkRoot = path.join(repositoryRoot, "benchmarks/camera-detection");
const manifest = JSON.parse(
  fs.readFileSync(path.join(benchmarkRoot, "manifest.json"), "utf8")
);
const labels = JSON.parse(
  fs.readFileSync(path.join(benchmarkRoot, "labels.json"), "utf8")
);
const cameraConfig = JSON.parse(
  fs.readFileSync(
    path.join(repositoryRoot, "shared/data/camera-detection-areas.json"),
    "utf8"
  )
);
const debuggerHtml = fs.readFileSync(
  path.join(repositoryRoot, "scripts/camera-polygon-annotator/index.html"),
  "utf8"
);
const viteConfig = fs.readFileSync(
  path.join(repositoryRoot, "client/vite.config.ts"),
  "utf8"
);
const iconSprite = fs.readFileSync(
  path.join(repositoryRoot, "scripts/camera-polygon-annotator/icons.svg"),
  "utf8"
);
const iconSource = fs.readFileSync(
  path.join(
    repositoryRoot,
    "scripts/camera-polygon-annotator/fontAwesomeIcons.ts"
  ),
  "utf8"
);

describe("camera detection benchmark", () => {
  // benchmark selection guard
  it("uses named pilot cameras and explicit disabled controls", () => {
    expect(
      [
        ...new Set(
          manifest.frames
            .filter(({ role }: { role: string }) => role === "test")
            .map(({ cameraName }: { cameraName: string }) => cameraName)
        ),
      ]
    ).toEqual(
      expect.arrayContaining([
        "Clover Lane",
        "Mukilteo Holding",
        "Clinton Holding",
        "Tollbooth / uphill",
        "Food Mart / east SR 525",
        "Post Office / west SR 525",
        "5th Street north",
        "5th Street south",
      ])
    );
    expect(
      manifest.frames
        .filter(({ role }: { role: string }) => role === "control")
        .map(({ cameraName }: { cameraName: string }) => cameraName)
    ).toEqual(["76th Street / school south", "Clover Lane empty control"]);
  });

  // immutable frame guard
  it("keeps every selected frame present and checksum verified", () => {
    manifest.frames.forEach(
      ({ file, sha256 }: { file: string; sha256: string }) => {
        const body = fs.readFileSync(path.join(benchmarkRoot, file));
        expect(body.length).toBeGreaterThan(1000);
        expect(crypto.createHash("sha256").update(body).digest("hex")).toBe(
          sha256
        );
      }
    );
  });

  // role eligibility guard
  it("uses reviewed polygon cameras and keeps every test camera enabled", () => {
    manifest.frames.forEach(
      ({ cameraId, role }: { cameraId: string; role: string }) => {
        const camera = cameraConfig.cameras[cameraId];
        expect(camera.allowedAreas.length).toBeGreaterThan(0);
        expect(camera.reviewed).toBe(true);
        // enabled test guard
        if (role === "test") {
          expect(camera.detectionEnabled !== false).toBe(true);
        }
      }
    );
  });

  // state contract guard
  it("uses the four-state spatial model and a writable label envelope", () => {
    expect(manifest.stateModel).toEqual({
      fullThreshold: 0.85,
      majorityThreshold: 0.5,
      signal: "principal-axis spatial coverage",
      states: ["empty", "minority_full", "majority_full", "full"],
    });
    expect(labels.schemaVersion).toBe(1);
    expect(labels.frames).toBeTypeOf("object");
    expect(
      labels.updatedAt === null || typeof labels.updatedAt === "string"
    ).toBe(true);
  });

  // standalone route contract
  it("uses app routes and session authorization without an iframe channel", () => {
    expect(debuggerHtml).toContain('href="/dev/camera-detection"');
    expect(debuggerHtml).toContain('href="/dev/camera-detection/benchmarks"');
    expect(debuggerHtml).toContain(
      "sessionStorage.getItem(debuggerTokenStorageKey)"
    );
    expect(debuggerHtml).toContain('"/api/admin/camera-detection"');
    expect(debuggerHtml).not.toContain("window.name");
  });

  // mobile interaction contract
  it("provides compact panels and pointer-based canvas editing", () => {
    expect(debuggerHtml).toContain("@media (max-width: 800px)");
    expect(debuggerHtml).toContain('id="showCameraPanel"');
    expect(debuggerHtml).toContain('id="showControlsPanel"');
    expect(debuggerHtml).toContain('canvas.addEventListener("pointerdown"');
    expect(debuggerHtml).toContain('canvas.addEventListener("pointermove"');
    expect(debuggerHtml).toContain('window.addEventListener("pointerup"');
    expect(debuggerHtml).toContain(
      "if (mobileViewport.matches) fitZoomToWidth()"
    );
    expect(debuggerHtml).toContain("const activeTouchPointers = new Map()");
    expect(debuggerHtml).toContain("function beginPinchGesture()");
    expect(debuggerHtml).toContain("function updatePinchGesture()");
    expect(debuggerHtml).toContain("setZoomAroundImagePoint");
  });

  // accelerated labeling contract
  it("autosaves labels and advances through incomplete polygons", () => {
    expect(debuggerHtml).toContain("async function applyBenchmarkState");
    expect(debuggerHtml).toContain("await queueBenchmarkSave");
    expect(debuggerHtml).toContain("advanceBenchmarkLabeling");
    expect(debuggerHtml).toContain("data-benchmark-card");
    expect(debuggerHtml).toContain("nextUnlabeledBenchmarkFrame");
  });

  // compact workflow contract
  it("uses contextual and segmented controls for frequent tasks", () => {
    expect(debuggerHtml).toContain('id="polygonRoleControl"');
    expect(debuggerHtml).toContain('id="benchmarkRoleControl"');
    expect(debuggerHtml).toContain('data-interaction="idle"');
    expect(debuggerHtml).toContain('class="benchmark-state" role="group"');
    expect(debuggerHtml).toContain("bindSegmentedControl");
    expect(debuggerHtml).not.toContain('<select id="state-');
  });

  // zoomed navigation contract
  it("supports explicit and temporary image panning", () => {
    expect(debuggerHtml).toContain('id="panBtn"');
    expect(debuggerHtml).toContain("canvasViewport.scrollLeft");
    expect(debuggerHtml).toContain("canvasViewport.scrollTop");
    expect(debuggerHtml).toContain('event.code !== "Space"');
    expect(debuggerHtml).toContain("event.button === 1");
  });

  // iconography contract
  it("uses a directly imported Font Awesome subset", () => {
    expect(cameraDetectionIconCount).toBe(17);
    expect(iconSprite).toBe(renderCameraDetectionIconSprite());
    expect(Buffer.byteLength(iconSprite)).toBeLessThan(10_000);
    expect(iconSource).toContain(
      'from "@fortawesome/free-solid-svg-icons/faArrowLeft"'
    );
    expect(iconSource).toContain(
      'from "@fortawesome/free-solid-svg-icons/faMagnifyingGlassPlus"'
    );
    expect(iconSource).not.toContain(
      'from "@fortawesome/free-solid-svg-icons"'
    );
    expect(debuggerHtml).toContain(
      '<use href="/dev/camera-detection/icons.svg#icon-hand"/>'
    );
    expect(debuggerHtml).not.toContain('<symbol id="icon-');
    expect(debuggerHtml).not.toMatch(/<button[^>]*>[←→↻↶＋−×]/);
  });

  // development route guard
  it("mounts both debugger pages in the live Vite middleware", () => {
    expect(viteConfig).toContain('"/dev/camera-detection"');
    expect(viteConfig).toContain('"/dev/camera-detection/benchmarks"');
    expect(viteConfig).toContain("cameraDetectionDebuggerPlugin()");
    expect(viteConfig).toContain("cameraDetectionDebuggerHtml");
    expect(viteConfig).toContain("cameraDetectionIconRoute");
  });
});
