// @vitest-environment jsdom
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  native: false,
  getState: vi.fn(),
  addListener: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("~/lib/analytics", () => ({ trackUsefulEvent: mocks.track }));
vi.mock("~/lib/device", () => ({ isNativeMobileApp: () => mocks.native }));
vi.mock("@capacitor/app", () => ({ App: mocks }));
import { useUsefulContent } from "../../client/lib/usefulVisits";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let visible = "visible";
let nativeChange: ((state: { isActive: boolean }) => void) | undefined;
const observers: Observer[] = [];

// provide explicit viewport transitions without browser timing uncertainty
class Observer {
  node?: Element;
  disconnected = false;
  records: IntersectionObserverEntry[] = [];
  // retain exact callback ownership
  constructor(readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  // observe only the attached meaningful node
  observe(node: Element): void {
    this.node = node;
  }
  // verify exact cleanup
  disconnect(): void {
    this.disconnected = true;
  }
  // expose queued transitions for final timer rechecks
  takeRecords(): IntersectionObserverEntry[] {
    return this.records.splice(0);
  }
  // dispatch a target-specific viewport transition
  intersect(ratio: number): void {
    this.callback(
      [
        {
          target: this.node,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver
    );
  }
}
// mount the real callback-ref hook with controllable content boundaries
const Harness = ({
  ready = true,
  identity = "schedule:3-7",
  replacement = false,
}: {
  ready?: boolean;
  identity?: string;
  replacement?: boolean;
}) => {
  const ref = useUsefulContent("schedule", identity, ready);
  return replacement ? (
    <section ref={ref}>schedule</section>
  ) : (
    <div ref={ref}>schedule</div>
  );
};
// retrieve only the current observer instance
const currentObserver = (): Observer =>
  observers.filter((observer) => !observer.disconnected).at(-1)!;
// render into the existing instance or a fresh real mount
const render = async (props = {}, strict = false): Promise<void> => {
  // create a root only for a real first mount
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => {
    root?.render(
      strict ? (
        <StrictMode>
          <Harness {...props} />
        </StrictMode>
      ) : (
        <Harness {...props} />
      )
    );
  });
};
// move the deterministic exposure clock
const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

// reset all lifecycle sources between cases
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  observers.length = 0;
  visible = "visible";
  mocks.native = false;
  nativeChange = undefined;
  vi.stubGlobal("IntersectionObserver", Observer);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visible,
  });
  mocks.getState.mockResolvedValue({ isActive: true });
  mocks.addListener.mockImplementation(async (_event, listener) => {
    nativeChange = listener;
    return { remove: mocks.remove };
  });
  mocks.remove.mockResolvedValue(undefined);
});
// prevent stale observers and timers from crossing tests
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("continuous useful-content exposure", () => {
  // strict-mode setup replay is not a second exposure
  it("qualifies at exactly five seconds and latches ordinary rerenders", async () => {
    await render({}, true);
    act(() => currentObserver().intersect(1));
    await advance(4999);
    expect(mocks.track).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith("useful_content_view", {
      surface: "schedule",
    });
    await render({}, true);
    await advance(20_000);
    expect(mocks.track).toHaveBeenCalledOnce();
  });

  // every interruption starts a fresh episode before and after qualification
  it.each(["viewport", "document", "ready", "identity", "node"])(
    "resets %s rather than pausing",
    async (gate) => {
      await render();
      act(() => currentObserver().intersect(1));
      await advance(3000);
      // apply the chosen eligibility interruption
      const interrupt = async (): Promise<void> => {
        // zero intersection loses eligibility
        if (gate === "viewport") act(() => currentObserver().intersect(0));
        // hidden documents lose eligibility
        if (gate === "document") {
          visible = "hidden";
          document.dispatchEvent(new Event("visibilitychange"));
        }
        // unreadied content loses eligibility
        if (gate === "ready") await render({ ready: false });
        // public content identity changes reset the episode
        if (gate === "identity") await render({ identity: "schedule:other" });
        // replacing the actual node resets the episode
        if (gate === "node") await render({ replacement: true });
      };
      // restore all gates for a fresh timed episode
      const restore = async (): Promise<void> => {
        // restore document eligibility with its lifecycle event
        if (gate === "document") {
          visible = "visible";
          document.dispatchEvent(new Event("visibilitychange"));
        }
        // return to ready content without reusing elapsed time
        if (gate === "ready") await render({ ready: true });
        act(() => currentObserver().intersect(1));
      };
      await interrupt();
      await restore();
      await advance(4999);
      expect(mocks.track).not.toHaveBeenCalled();
      await advance(1);
      expect(mocks.track).toHaveBeenCalledOnce();
      // switch identities or nodes again to establish another real boundary
      if (gate === "identity") await render({ identity: "schedule:again" });
      else if (gate === "node") await render({ replacement: false });
      else await interrupt();
      await restore();
      await advance(4999);
      expect(mocks.track).toHaveBeenCalledOnce();
      await advance(1);
      expect(mocks.track).toHaveBeenCalledTimes(2);
    }
  );

  // a later same-identity remount is not document-wide deduplicated
  it("cleans up before qualification and permits later real remounts", async () => {
    await render();
    const old = currentObserver();
    act(() => old.intersect(1));
    await advance(4999);
    act(() => root?.unmount());
    root = undefined;
    await advance(10_000);
    old.intersect(1);
    expect(mocks.track).not.toHaveBeenCalled();
    expect(old.disconnected).toBe(true);
    await render();
    act(() => currentObserver().intersect(1));
    await advance(5000);
    expect(mocks.track).toHaveBeenCalledOnce();
  });

  // pending visibility and viewport changes win at the timer boundary
  it.each(["document", "viewport"])(
    "rechecks %s without relying on listener timing",
    async (gate) => {
      await render();
      act(() => currentObserver().intersect(1));
      await advance(4999);
      // hide without sending the visibility event
      if (gate === "document") visible = "hidden";
      // queue an offscreen observer record before its callback arrives
      else
        currentObserver().records.push({
          target: currentObserver().node,
          isIntersecting: false,
          intersectionRatio: 0,
        } as IntersectionObserverEntry);
      await advance(1);
      expect(mocks.track).not.toHaveBeenCalled();
    }
  );

  // a final positive record cannot erase an interruption queued before the timer
  it("restarts after pending offscreen-then-visible records", async () => {
    await render();
    act(() => currentObserver().intersect(1));
    await advance(4999);
    const observer = currentObserver();
    observer.records.push(
      {
        target: observer.node,
        isIntersecting: false,
        intersectionRatio: 0,
      } as IntersectionObserverEntry,
      {
        target: observer.node,
        isIntersecting: true,
        intersectionRatio: 1,
      } as IntersectionObserverEntry
    );
    await advance(1);
    expect(mocks.track).not.toHaveBeenCalled();
    await advance(4999);
    expect(mocks.track).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.track).toHaveBeenCalledOnce();
  });

  // unsupported viewport observation and server rendering remain silent
  it("fails closed without observation and performs no server effect", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    expect(renderToStaticMarkup(<Harness />)).toContain("schedule");
    await render();
    await advance(10_000);
    expect(observers).toHaveLength(0);
    expect(mocks.track).not.toHaveBeenCalled();
  });

  // native state must be confirmed before any exposure time accrues
  it("waits for native state and resets native background episodes", async () => {
    mocks.native = true;
    let resolveState: ((state: { isActive: boolean }) => void) | undefined;
    mocks.getState.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveState = resolve;
        })
    );
    await render();
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    act(() => currentObserver().intersect(1));
    nativeChange?.({ isActive: true });
    await advance(10_000);
    expect(mocks.track).not.toHaveBeenCalled();
    await act(async () => resolveState?.({ isActive: true }));
    await advance(3000);
    nativeChange?.({ isActive: false });
    nativeChange?.({ isActive: true });
    await advance(4999);
    expect(mocks.track).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.track).toHaveBeenCalledOnce();
    nativeChange?.({ isActive: false });
    nativeChange?.({ isActive: true });
    await advance(5000);
    expect(mocks.track).toHaveBeenCalledTimes(2);
    act(() => root?.unmount());
    root = undefined;
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  // stale get-state results cannot overwrite a newer lifecycle event
  it("ignores stale native snapshots and removes late listener handles", async () => {
    mocks.native = true;
    let resolveState: ((state: { isActive: boolean }) => void) | undefined;
    mocks.getState.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveState = resolve;
        })
    );
    await render();
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    act(() => currentObserver().intersect(1));
    nativeChange?.({ isActive: false });
    await act(async () => resolveState?.({ isActive: true }));
    await advance(5000);
    expect(mocks.track).not.toHaveBeenCalled();
    act(() => root?.unmount());
    root = undefined;
    let resolveListener:
      | ((handle: { remove: typeof mocks.remove }) => void)
      | undefined;
    mocks.addListener.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveListener = resolve;
        })
    );
    await render();
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    act(() => root?.unmount());
    root = undefined;
    await act(async () => resolveListener?.({ remove: mocks.remove }));
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });
});
