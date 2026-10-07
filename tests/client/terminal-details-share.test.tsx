// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShareOptions } from "../../client/views/Menu";
import type { Terminal } from "../../shared/contracts/terminals";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const observeHeaderProps = vi.hoisted(() => vi.fn());

vi.mock("~/components/AdSlot", () => ({
  AdSlot: () => null,
}));
vi.mock("~/components/ExternalPillLink", () => ({
  // preserve link children without external behavior
  ExternalPillLink: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("~/components/TerminalDropdown", () => ({
  TerminalDropdown: () => null,
}));
vi.mock("~/lib/featureFlags", () => ({
  useFeatureFlags: () => ({ leaderboardsEnabled: false }),
}));
vi.mock("~/lib/maps", () => ({
  locationToUrl: () => "https://maps.example/terminal",
}));
vi.mock("~/lib/terminals", () => ({
  getSlug: (id: string) => id,
  useTerminals: () => ({ closestTerminal: null, terminals: [] }),
}));
vi.mock("../../client/views/Header", () => ({
  // capture the terminal share contract
  Header: ({
    children,
    share,
  }: React.PropsWithChildren<{ share?: ShareOptions }>) => {
    observeHeaderProps({ share });
    return React.createElement("header", null, children);
  },
}));

import { TerminalDetails } from "../../client/views/TerminalDetails";

const terminal = {
  abbreviation: "CLI",
  bulletins: [],
  cameras: [],
  hasElevator: false,
  hasFood: true,
  hasOverheadLoading: false,
  hasRestroom: true,
  hasWaitingRoom: true,
  id: "5",
  info: {},
  location: {
    address: {},
    latitude: 47.98,
    longitude: -122.35,
  },
  mates: [],
  name: "Clinton",
  popularity: 1,
  routes: {},
  waitTimes: [],
} as Terminal;

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("TerminalDetails share contract", () => {
  // terminal owner boundary
  it("provides the terminal share contract to Header", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        React.createElement(
          MemoryRouter,
          undefined,
          React.createElement(TerminalDetails, {
            getPath: () => "/clinton",
            mate: null,
            setRoute: () => undefined,
            terminal,
          })
        )
      );
    });

    expect(observeHeaderProps).toHaveBeenLastCalledWith({
      share: {
        shareButtonText: "Share Terminal",
        sharedText: "Clinton Ferry Terminal details",
        shareSurface: "terminal",
      },
    });
  });
});
