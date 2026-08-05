// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const visibility = vi.hoisted(() => vi.fn());

vi.mock("~/lib/generated/vesselAssets", () => ({ vesselAssets: {} }));
vi.mock("~/lib/geo", () => ({ useGeo: () => [null] }));
vi.mock("~/lib/onboardSailing", () => ({
  getArrivedSailing: () => null,
  getEstimatedDepartureMinutes: () => 12,
  getOnboardSailing: () => ({
    departureTerminal: {
      abbreviation: "CLI",
      hasOverheadLoading: false,
      id: "5",
      name: "Clinton",
    },
    destinationTerminal: {
      abbreviation: "MUK",
      hasOverheadLoading: true,
      id: "14",
      name: "Mukilteo",
    },
    etaMinutes: 12,
    progress: 0.5,
    vessel: {
      id: "vessel",
      isAtDock: false,
      name: "Tokitae",
    },
  }),
  getProjectedSailingProgress: () => 0.5,
  getTrackedSailing: () => null,
}));
vi.mock("~/lib/onboardSimulation", () => ({
  useSimulatedVesselId: () => "vessel",
}));
vi.mock("~/lib/onboardTracking", () => ({
  useTrackedVessel: () => [null],
}));
vi.mock("~/lib/renderContext", () => ({
  useAppRenderContext: () => ({ clock: () => 1_700_000_000_000 }),
}));
vi.mock("~/lib/terminals", () => ({
  getSlug: (id: string) => id,
  useTerminals: () => ({ terminals: [{ id: "5" }] }),
}));
vi.mock("~/lib/vessels", () => ({ useLiveVessels: () => [] }));
vi.mock("~/static/images/icons/solid/map-marker.svg", () => ({
  default: () => React.createElement("svg"),
}));

import { OnboardSailingBanner } from "../../client/components/OnboardSailingBanner";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      observe = vi.fn();
    }
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  visibility.mockReset();
  vi.unstubAllGlobals();
});

describe("OnboardSailingBanner", () => {
  it("does not intercept navigation input while visible", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<OnboardSailingBanner onVisibilityChange={visibility} />);
      await Promise.resolve();
    });

    const banner = container.querySelector("aside");
    expect(banner?.className).toContain("pointer-events-none");
    expect(visibility).toHaveBeenCalledWith(true);
  });
});
