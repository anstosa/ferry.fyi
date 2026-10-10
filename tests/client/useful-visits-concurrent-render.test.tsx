// @vitest-environment jsdom
import { DateTime } from "luxon";
import React, { act, startTransition, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  FareCatalogApiResponse,
  FareQuoteApiResponse,
  FareQuoteRequest,
} from "shared/contracts/fares";
import type { Terminal } from "shared/contracts/terminals";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const analytics = vi.hoisted(() => ({ trackUsefulEvent: vi.fn() }));
const api = vi.hoisted(() => ({
  getCameraFrames: vi.fn(),
  getFareCatalog: vi.fn(),
  getFareQuote: vi.fn(),
}));

vi.mock("~/lib/analytics", () => analytics);
vi.mock("~/lib/cameras", () => ({ getCameraFrames: api.getCameraFrames }));
vi.mock("~/lib/fares", () => ({
  getFareCatalog: api.getFareCatalog,
  getFareQuote: api.getFareQuote,
}));
vi.mock("~/lib/maps", () => ({ locationToUrl: () => "#" }));
vi.mock("~/lib/ssrSeed", () => ({ usePublicSsrSource: () => undefined }));
vi.mock("~/lib/terminals", () => ({
  getSlug: (id: string) => id,
  useTerminals: () => ({ closestTerminal: null, terminals: [] }),
}));
vi.mock("react-router-dom", () => ({
  // render public planning links without a router-owned test boundary
  Link: ({
    children,
    to,
    ...props
  }: React.PropsWithChildren<{ className?: string; to: string }>) =>
    React.createElement("a", { ...props, href: to }, children),
  // expose the committed url used by fare configuration updates
  useLocation: () => ({
    hash: window.location.hash,
    pathname: window.location.pathname,
    search: window.location.search,
  }),
  // mirror replacement navigation while component state drives test renders
  useNavigate:
    () =>
    // retain the updated configuration across suspended route renders
    ({
      hash,
      pathname,
      search,
    }: {
      hash: string;
      pathname: string;
      search: string;
    }) =>
      window.history.replaceState(null, "", `${pathname}${search}${hash}`),
}));
vi.mock("@capacitor/share", () => ({
  Share: {
    canShare: vi.fn().mockResolvedValue({ value: false }),
    share: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("~/components/AdSlot", () => ({ AdSlot: () => null }));
vi.mock("~/components/CameraImageFooter", () => ({
  CameraImageFooter: () => null,
}));
vi.mock("~/components/DateButton", () => ({ DateButton: () => null }));
vi.mock("~/components/ExternalPillLink", () => ({
  ExternalPillLink: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/components/FareCatalogDisclosure", () => ({
  FareCatalogDisclosure: () => null,
}));
vi.mock("~/components/FareWizardIcons", () => {
  // keep wizard controls renderable without svg transforms
  const Icon = () => React.createElement("svg");
  return {
    fareWizardIcons: {
      bicycle: Icon,
      car: Icon,
      carSide: Icon,
      motorcycle: Icon,
      ruler: Icon,
      truck: Icon,
      undo: Icon,
      user: Icon,
      walking: Icon,
      wheelchair: Icon,
    },
  };
});
vi.mock("~/components/RouteSelector", () => ({ RouteSelector: () => null }));
vi.mock("~/components/Skeleton", () => ({
  Skeleton: () => null,
  SkeletonGroup: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/components/TerminalDropdown", () => ({
  TerminalDropdown: () => null,
}));
vi.mock("~/views/Header", () => ({
  Header: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../client/components/ReloadButton", () => ({
  ReloadButton: () => null,
}));
vi.mock("~/static/images/icons/solid/car.svg", () => ({ default: () => null }));
vi.mock("~/static/images/icons/solid/location.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/map-marked.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/map-marker.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/share-alt.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/ship.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/wsdot.svg", () => ({ default: () => null }));

import { useUsefulContent } from "../../client/lib/usefulVisits";
import { Cameras } from "../../client/views/Cameras";
import { Fares } from "../../client/views/Fares";

let root: Root | undefined;
let visible: DocumentVisibilityState = "visible";
const observers: TestObserver[] = [];
const never = new Promise<never>(() => undefined);

// provide deterministic viewport state to the production hook
class TestObserver {
  disconnected = false;
  node?: Element;
  records: IntersectionObserverEntry[] = [];

  // retain the production callback
  constructor(readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }

  // retain the observed content node
  observe(node: Element): void {
    this.node = node;
  }

  // mark effect cleanup
  disconnect(): void {
    this.disconnected = true;
  }

  // return pending boundary records
  takeRecords(): IntersectionObserverEntry[] {
    return this.records.splice(0);
  }

  // publish an exact viewport transition
  intersect(ratio: number): void {
    this.callback(
      [
        {
          intersectionRatio: ratio,
          isIntersecting: ratio > 0,
          target: this.node,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver
    );
  }
}

// suspend a transition after its production sibling has rendered
const Never = (): never => {
  throw never;
};

// preserve the committed tree while a replacement suspends
const Boundary = ({
  children,
  pending = false,
}: {
  children: React.ReactNode;
  pending?: boolean;
}): React.ReactElement => (
  <Suspense fallback={<p>pending</p>}>
    {children}
    {pending && <Never />}
  </Suspense>
);

// mount or synchronously replace the test tree
const render = async (element: React.ReactNode): Promise<HTMLDivElement> => {
  // create one concurrent root per case
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => {
    root?.render(element);
    // settle chained catalog and quote effects
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  });
  return rootContainer();
};

// retrieve the mounted test container
const rootContainer = (): HTMLDivElement =>
  document.body.firstElementChild as HTMLDivElement;

// begin a replacement that renders but cannot commit
const renderPending = async (element: React.ReactNode): Promise<void> => {
  await act(async () => {
    startTransition(() => {
      root?.render(<Boundary pending>{element}</Boundary>);
    });
    await Promise.resolve();
  });
};

// retrieve the live production observer
const currentObserver = (): TestObserver =>
  observers.filter(({ disconnected }) => !disconnected).at(-1)!;

// build one terminal with an intentionally shared camera id
const makeTerminal = (id: string, name: string): Terminal =>
  ({
    abbreviation: name.slice(0, 3).toUpperCase(),
    bulletins: [],
    cameras: [
      {
        id: "shared-camera",
        image: { url: `https://example.test/${id}.jpg` },
        location: {},
        title: `${name} dock`,
      },
    ],
    hasElevator: false,
    hasFood: false,
    hasOverheadLoading: false,
    hasRestroom: true,
    hasWaitingRoom: true,
    id,
    info: {},
    location: { address: {}, latitude: 47.6, longitude: -122.3 },
    mates: [],
    name,
    popularity: 0,
    routes: {},
    terminalUrl: null,
    waitTimes: [],
  }) as Terminal;

const terminalA = makeTerminal("1", "Seattle");
const terminalB = makeTerminal("3", "Bremerton");
const mate = makeTerminal("2", "Bainbridge");
const date = DateTime.fromISO("2026-07-18");
const fareFreshness = {
  fetchedAt: 1,
  policyVersion: "test",
  sourceCacheFlushDate: null,
  validFrom: "2026-01-01",
  validThrough: "2026-12-31",
} as const;

// build one exact route-scoped fare catalog
const makeCatalog = (terminal: Terminal): FareCatalogApiResponse => ({
  catalog: {
    collectionDescription: "One-way fares",
    fares: [
      {
        amount: 20,
        category: "Vehicle",
        directionIndependent: false,
        id: 4,
        label: "Vehicle Under 22' (standard veh) & Driver",
      },
      {
        amount: 10,
        category: "Passenger",
        directionIndependent: false,
        id: 1,
        label: "Adult",
      },
    ],
    freshness: fareFreshness,
    kind: "catalog",
    request: {
      arrivingTerminalId: mate.id,
      departingTerminalId: terminal.id,
      roundTrip: false,
      tripDate: "2026-07-18",
    },
  },
  state: "current",
});

// echo one usable fare request
const makeQuote = (request: FareQuoteRequest): FareQuoteApiResponse => ({
  quote: {
    freshness: fareFreshness,
    kind: "quote",
    request,
    totals: [
      {
        amount: 30,
        briefDescription: "Total",
        description: "One-way total",
        type: "total",
      },
    ],
  },
  state: "current",
});

// render a fare route without changing component identity
const fareView = (terminal: Terminal): React.ReactElement => (
  <Fares
    date={date}
    mate={mate}
    setDate={vi.fn()}
    setRoute={vi.fn()}
    terminal={terminal}
  />
);

// bind one real useful-content exposure
const Exposure = ({ identity }: { identity: string }): React.ReactElement => {
  const ref = useUsefulContent("schedule", identity, true);
  return <main ref={ref}>schedule {identity}</main>;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  observers.length = 0;
  visible = "visible";
  vi.stubGlobal("IntersectionObserver", TestObserver);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visible,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
  window.history.replaceState(
    null,
    "",
    "/?fareMode=vehicle&fareDriver=standard&fareVehicle=standard&fareAdults=0&fareChildren=0&fareSeniors=0"
  );
  api.getCameraFrames.mockResolvedValue({ frames: {} });
  api.getFareCatalog.mockImplementation((terminal: Terminal) =>
    Promise.resolve(makeCatalog(terminal))
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useful visit concurrent render safety", () => {
  // speculative identity cannot poison a committed timer
  it("qualifies committed content while another identity suspends", async () => {
    await render(
      <Boundary>
        <Exposure identity="route-a" />
      </Boundary>
    );
    act(() => currentObserver().intersect(1));
    act(() => vi.advanceTimersByTime(3000));

    await renderPending(<Exposure identity="route-b" />);
    act(() => vi.advanceTimersByTime(2000));

    expect(analytics.trackUsefulEvent).toHaveBeenCalledExactlyOnceWith(
      "useful_content_view",
      { surface: "schedule" }
    );
  });

  // speculative terminal cannot reject the committed image outcome
  it("qualifies the committed camera after an overlapping terminal suspends", async () => {
    const container = await render(
      <Boundary>
        <Cameras setRoute={vi.fn()} terminal={terminalA} />
      </Boundary>
    );
    const committedImage = container.querySelector("img");
    expect(committedImage?.getAttribute("src")).toContain("/1.jpg");

    await renderPending(<Cameras setRoute={vi.fn()} terminal={terminalB} />);
    act(() => committedImage?.dispatchEvent(new Event("load")));
    await render(
      <Boundary>
        <Cameras setRoute={vi.fn()} terminal={terminalA} />
      </Boundary>
    );

    act(() => currentObserver().intersect(1));
    act(() => vi.advanceTimersByTime(5000));
    expect(analytics.trackUsefulEvent).toHaveBeenCalledExactlyOnceWith(
      "useful_content_view",
      { surface: "cameras" }
    );
  });

  // an empty inventory invalidates the prior successful image load
  it("requires a fresh image after cameras disappear at the same terminal", async () => {
    // keep component identity while replacing only the camera inventory
    const cameraView = (terminal: Terminal): React.ReactElement => (
      <Cameras setRoute={vi.fn()} terminal={terminal} />
    );
    const container = await render(cameraView(terminalA));
    act(() => container.querySelector("img")?.dispatchEvent(new Event("load")));
    act(() => currentObserver().intersect(1));
    act(() => vi.advanceTimersByTime(5000));
    expect(analytics.trackUsefulEvent).toHaveBeenCalledExactlyOnceWith(
      "useful_content_view",
      { surface: "cameras" }
    );
    analytics.trackUsefulEvent.mockClear();

    await render(cameraView({ ...terminalA, cameras: [] }));
    expect(container.querySelector("img")).toBeNull();
    const restored = await render(cameraView(terminalA));
    expect(restored.querySelector("img")).not.toBeNull();
    // publish visibility only if an erroneous ready observer was created
    const prematureObserver = observers.find(
      ({ disconnected }) => !disconnected
    );
    act(() => prematureObserver?.intersect(1));
    act(() => vi.advanceTimersByTime(5000));
    expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();

    act(() => restored.querySelector("img")?.dispatchEvent(new Event("load")));
    act(() => currentObserver().intersect(1));
    act(() => vi.advanceTimersByTime(4999));
    expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(analytics.trackUsefulEvent).toHaveBeenCalledExactlyOnceWith(
      "useful_content_view",
      { surface: "cameras" }
    );
  });

  // speculative route cannot discard a committed user quote result
  it("settles the committed fare quote while another route suspends", async () => {
    let resolveUserQuote: (response: FareQuoteApiResponse) => void = () =>
      undefined;
    let userRequest: FareQuoteRequest | undefined;
    api.getFareQuote
      .mockImplementationOnce((request: FareQuoteRequest) =>
        Promise.resolve(makeQuote(request))
      )
      .mockImplementationOnce(
        (request: FareQuoteRequest) =>
          new Promise<FareQuoteApiResponse>((resolve) => {
            userRequest = request;
            resolveUserQuote = resolve;
          })
      );
    const container = await render(<Boundary>{fareView(terminalA)}</Boundary>);
    const increaseAdults = container.querySelector<HTMLButtonElement>(
      '[aria-label="Increase Adults"]'
    );
    expect(increaseAdults).not.toBeNull();
    await act(async () => {
      increaseAdults?.click();
      // settle the configuration and quote effects
      for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
      }
    });
    expect(api.getFareQuote).toHaveBeenCalledTimes(2);

    await renderPending(fareView(terminalB));
    await act(async () => {
      resolveUserQuote(makeQuote(userRequest!));
      await Promise.resolve();
    });
    await render(<Boundary>{fareView(terminalA)}</Boundary>);

    expect(container.textContent).toContain("$30.00");
    expect(analytics.trackUsefulEvent).toHaveBeenCalledExactlyOnceWith(
      "fare_quote_available",
      { freshness: "current" }
    );
  });
});
