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

  it("shows the source image update time", () => {
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

    expect(container.textContent).toBe("Updated 2 mins ago");
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

    expect(container.textContent).toBe("Checked 1 min ago");
  });

  it("shows a loading status before camera metadata arrives", () => {
    const { container } = renderFreshness(
      React.createElement(CameraFrameFreshness)
    );

    expect(container.textContent).toBe("Checking image…");
  });
});
