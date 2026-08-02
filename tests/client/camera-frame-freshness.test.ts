// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { CameraFrameFreshness } from "../../client/components/CameraFrameFreshness";

const roots: Root[] = [];

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const renderFreshness = (element: React.ReactElement): RenderResult => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });
  roots.push(root);

  return { container, root };
};

describe("CameraFrameFreshness", () => {
  afterEach(() => {
    act(() => {
      roots.forEach((root) => root.unmount());
    });
    roots.length = 0;
    document.body.innerHTML = "";
  });

  it("shows the latest successful camera check time", () => {
    const { container } = renderFreshness(
      React.createElement(CameraFrameFreshness, {
        frameStatus: {
          cameraId: "9048",
          checkedAt: 1_000,
          error: null,
          frameToken: '"image"',
          frameUpdatedAt: 880,
          imageUrl: "https://example.com/camera.jpg",
          isStale: false,
        },
        now: 1_000,
      })
    );

    expect(container.textContent).toBe("Updated just now");
  });

  it("shows the check time when the source does not provide an update time", () => {
    const { container } = renderFreshness(
      React.createElement(CameraFrameFreshness, {
        frameStatus: {
          cameraId: "9048",
          checkedAt: 940,
          error: null,
          frameToken: null,
          frameUpdatedAt: null,
          imageUrl: "https://example.com/camera.jpg",
          isStale: false,
        },
        now: 1_000,
      })
    );

    expect(container.textContent).toBe("Updated 1 min ago");
  });

  it("does not expose an implausibly old source timestamp", () => {
    const { container } = renderFreshness(
      React.createElement(CameraFrameFreshness, {
        frameStatus: {
          cameraId: "9035",
          checkedAt: 1_785_685_969,
          error: null,
          frameToken: '"stale"',
          frameUpdatedAt: 1_063_043_729,
          imageUrl: "https://example.com/stale-camera.jpg",
          isStale: true,
        },
        now: 1_785_685_969,
      })
    );

    expect(container.textContent).toBe("Updated just now");
  });

  it("shows a loading status before camera metadata arrives", () => {
    const { container } = renderFreshness(
      React.createElement(CameraFrameFreshness)
    );

    expect(container.textContent).toBe("Checking image…");
  });

  it("does not announce freshness that is updated by camera polling", () => {
    const { container } = renderFreshness(
      React.createElement(CameraFrameFreshness, {
        frameStatus: {
          cameraId: "9048",
          checkedAt: 1_000,
          error: null,
          frameToken: '"image"',
          frameUpdatedAt: 880,
          imageUrl: "https://example.com/camera.jpg",
          isStale: false,
        },
        now: 1_000,
        passive: true,
      })
    );

    expect(container.textContent).toBe("Updated just now");
    expect(container.querySelector("[role=status]")).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull();
  });
});
