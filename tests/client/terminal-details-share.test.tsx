// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShareOptions } from "../../client/views/Menu";
import type { Terminal } from "../../shared/contracts/terminals";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const observeHeaderProps = vi.hoisted(() => vi.fn());
const observeAdProps = vi.hoisted(() => vi.fn());
const featureFlags = vi.hoisted(() => ({ leaderboardsEnabled: false }));
// control delayed placement readiness independently of terminal rendering
const adLayout = vi.hoisted(() => ({
  onReadyChange: undefined as undefined | ((ready: boolean) => void),
  ready: true,
}));

// model native scrolling absent from jsdom
const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;

vi.mock("~/components/AdSlot", () => ({
  // retain placement for travel-answer ordering assertions
  AdSlot: (props: Record<string, unknown>) => {
    observeAdProps(props);
    const onReadyChange = props.onReadyChange as
      | ((ready: boolean) => void)
      | undefined;
    adLayout.onReadyChange = onReadyChange;
    // model the placement's committed layout signal
    React.useEffect(() => onReadyChange?.(adLayout.ready), [onReadyChange]);
    return <div data-ad-slot="terminal" />;
  },
}));
vi.mock("~/components/TerminalDropdown", () => ({
  TerminalDropdown: () => null,
}));
vi.mock("~/lib/featureFlags", () => ({
  useFeatureFlags: () => featureFlags,
}));
vi.mock("~/lib/terminals", () => ({
  getSlug: (id: string) => id,
  useTerminals: () => ({ closestTerminal: null, terminals: [] }),
}));
vi.mock("../../client/views/Header", () => ({
  // capture terminal sharing without retaining the removed WSF menu link
  Header: ({
    children,
    items,
    share,
  }: React.PropsWithChildren<{ items?: unknown[]; share?: ShareOptions }>) => {
    observeHeaderProps({ items, share });
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

// mount real terminal content with isolated browser integrations
const render = (
  value: Terminal = terminal,
  mate: Terminal | null = null
): HTMLElement => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  // commit the terminal guide before inspecting it
  act(() => {
    root?.render(
      <MemoryRouter>
        <TerminalDetails
          getPath={() => "/clinton"}
          mate={mate}
          setRoute={() => undefined}
          terminal={value}
        />
      </MemoryRouter>
    );
  });
  return container;
};

// reset mounted content and feature state between examples
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  featureFlags.leaderboardsEnabled = false;
  adLayout.ready = true;
  window.history.replaceState(null, "", "/");
});

describe("TerminalDetails share contract", () => {
  // restore a linked section after the browser-only guide mounts
  it("scrolls to an initial terminal fragment without scrolling again on render", () => {
    adLayout.ready = false;
    window.history.replaceState(null, "", "/clinton/terminal#terminal-parking");
    render();
    expect(scrollIntoView).not.toHaveBeenCalled();
    // late creative insertion must settle before the initial jump
    act(() => adLayout.onReadyChange?.(true));
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "start",
    });
    expect((scrollIntoView.mock.contexts[0] as Element).id).toBe(
      "terminal-parking"
    );
    // unrelated hashes are not terminal jump targets
    window.history.replaceState(
      null,
      "",
      "/clinton/terminal#tripAddress=private"
    );
    act(() =>
      root?.render(
        <MemoryRouter>
          <TerminalDetails
            getPath={() => "/clinton"}
            mate={null}
            setRoute={() => undefined}
            terminal={{ ...terminal }}
          />
        </MemoryRouter>
      )
    );
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  // terminal owner boundary
  it("provides the terminal share contract to Header", () => {
    const page = render({
      ...terminal,
      terminalUrl: "https://example.com/terminal",
    });

    // animate native section links only when motion is allowed
    expect(page.querySelector("main")?.classList).toContain(
      "motion-safe:scroll-smooth"
    );

    expect(observeHeaderProps).toHaveBeenLastCalledWith({
      items: undefined,
      share: {
        shareButtonText: "Share Terminal",
        sharedText: "Clinton Ferry Terminal details",
        shareSurface: "terminal",
      },
    });
  });

  // selected multi-route destinations scope both the buttons and the existing ad
  it("retains the selected direction in route links and the terminal ad", () => {
    const page = render(
      {
        ...terminal,
        id: "7",
        name: "Seattle",
        mates: [
          { id: "3", name: "Bainbridge Island", abbreviation: "BBG" },
          { id: "4", name: "Bremerton", abbreviation: "BRE" },
        ],
      },
      { ...terminal, id: "4", name: "Bremerton" }
    );
    const planning = page.querySelector(
      'nav[aria-label="Terminal planning links"]'
    )!;
    expect(
      planning.querySelector('a[href="/seattle/bremerton"]')
    ).not.toBeNull();
    expect(planning.querySelector('a[href="/seattle/bainbridge"]')).toBeNull();
    expect(observeAdProps).toHaveBeenLastCalledWith({
      arrivalTerminalId: "4",
      contextLabel: "Terminal · Seattle to Bremerton",
      departureTerminalId: "7",
      onReadyChange: expect.any(Function),
      slot: "terminal",
    });
  });

  // live provider nulls must not crash the entire route view
  it("handles null and empty WSF prose fields", () => {
    const page = render({
      ...terminal,
      info: {
        parking: null,
        ada: null,
        food: "<p>&nbsp;</p>",
      } as unknown as Terminal["info"],
    });
    expect(page.querySelector("h1")?.textContent).toBe(
      "Clinton Ferry Terminal"
    );
    expect(page.textContent).toContain("Parking details are not available");
    expect(page.textContent).toContain(
      "Accessibility details are not available"
    );
  });

  // preserve inert prose with the ad after navigation and leaderboards after answers
  it("renders provider details without clicks and puts the ad after navigation", () => {
    featureFlags.leaderboardsEnabled = true;
    const page = render({
      ...terminal,
      info: {
        parking:
          '<p>Park nearby &amp; check rates.</p><p>See <a href=" https://example.com/parking ">parking operator</a>.</p><script>unwanted source script</script>',
        ada: "<p>Ask for boarding assistance.</p>",
        food: "<p>Food service details.</p>",
        security: "<p>Security guidance.</p>",
      },
      waitTimes: [
        { description: "<p>Arrive early &amp; check conditions.</p>", time: 0 },
      ],
    });
    expect(page.querySelector("#terminal-parking")?.textContent).toContain(
      "Park nearby & check rates.\nSee parking operator (https://example.com/parking)."
    );
    expect(
      page.querySelector("#terminal-accessibility")?.textContent
    ).toContain("Ask for boarding assistance.");
    expect(page.querySelector("#terminal-facilities")?.textContent).toContain(
      "Food service details."
    );
    expect(
      page.querySelector('[aria-label="More terminal information"]')
        ?.textContent
    ).toContain("Security guidance.");
    expect(page.querySelector("#terminal-arrival")?.textContent).toContain(
      "Arrive early & check conditions."
    );
    expect(page.querySelector("script")).toBeNull();
    expect(page.textContent).not.toContain("unwanted source script");
    const facilities = page.querySelector("#terminal-facilities")!;
    const ad = page.querySelector('[data-ad-slot="terminal"]')!;
    expect(page.querySelectorAll('[data-ad-slot="terminal"]')).toHaveLength(1);
    expect(ad.previousElementSibling?.getAttribute("aria-label")).toBe(
      "Terminal information"
    );
    expect(
      ad.compareDocumentPosition(facilities) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      facilities.compareDocumentPosition(
        page.querySelector('a[href="/leaderboards/terminals/5"]')!
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
