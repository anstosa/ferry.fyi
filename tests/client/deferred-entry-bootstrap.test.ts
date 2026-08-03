// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { scheduleDeferredStartup } from "../../client/entry-bootstrap";

const snapshotDocument = (
  contains = () => true,
  readyState: DocumentReadyState = "complete"
): Document =>
  ({
    querySelector: () => ({
      contains,
      getAttribute: () => "snapshot",
      hasChildNodes: () => true,
    }),
    readyState,
  }) as unknown as Document;

afterEach(() => {
  document.body.replaceChildren();
});

describe("deferred client startup", () => {
  it("loads hydration after two paint frames without waiting for window load", async () => {
    const frames: FrameRequestCallback[] = [];
    const timers: Array<{ callback: () => void; delay: number }> = [];
    const idleCallbacks: IdleRequestCallback[] = [];
    const clientReady = Promise.resolve();
    const loadClient = vi.fn(() => Promise.resolve({ clientReady }));
    const startSentry = vi.fn(() => Promise.resolve());
    const loadSentry = vi.fn(() => Promise.resolve({ startSentry }));
    const browserWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
      requestIdleCallback: vi.fn((callback: IdleRequestCallback) => {
        idleCallbacks.push(callback);
        return idleCallbacks.length;
      }),
      setTimeout: vi.fn((callback: () => void, delay: number) => {
        timers.push({ callback, delay });
        return timers.length;
      }),
    };

    scheduleDeferredStartup({
      document: snapshotDocument(() => true, "loading"),
      loadClient,
      loadSentry,
      window: browserWindow as never,
    });

    expect(loadClient).not.toHaveBeenCalled();
    frames.shift()?.(0);
    expect(loadClient).not.toHaveBeenCalled();
    frames.shift()?.(16);
    await Promise.resolve();
    expect(loadClient).toHaveBeenCalledOnce();
    expect(loadSentry).not.toHaveBeenCalled();

    expect(timers[0]?.delay).toBe(10_000);
    timers.shift()?.callback();
    expect(loadSentry).not.toHaveBeenCalled();
    idleCallbacks.shift()?.({ didTimeout: false, timeRemaining: () => 10 });
    await Promise.resolve();

    expect(loadSentry).toHaveBeenCalledOnce();
    expect(startSentry).toHaveBeenCalledOnce();
  });

  it("starts on user intent and replays a deferred button click", async () => {
    const frames: FrameRequestCallback[] = [];
    const listeners = new Map<string, EventListener>();
    let resolveClient: (() => void) | undefined;
    const clientReady = new Promise<void>((resolve) => {
      resolveClient = resolve;
    });
    const loadClient = vi.fn(() => Promise.resolve({ clientReady }));
    const button = document.createElement("button");
    document.body.append(button);
    const click = vi.spyOn(button, "click");
    const browserWindow = {
      addEventListener: vi.fn(
        (eventName: string, listener: EventListenerOrEventListenerObject) => {
          listeners.set(eventName, listener as EventListener);
        }
      ),
      removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
      setTimeout: vi.fn(() => 1),
    };

    scheduleDeferredStartup({
      document: snapshotDocument(),
      loadClient,
      loadSentry: () => Promise.resolve({ startSentry: vi.fn() }),
      window: browserWindow as never,
    });
    frames.shift()?.(0);
    frames.shift()?.(16);

    listeners.get("pointerdown")?.(new Event("pointerdown"));
    expect(loadClient).toHaveBeenCalledOnce();
    const clickEvent = {
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
      target: button,
    } as unknown as MouseEvent;
    listeners.get("click")?.(clickEvent);
    expect(clickEvent.preventDefault).toHaveBeenCalledOnce();
    expect(clickEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();

    resolveClient?.();
    await clientReady;

    expect(loadClient).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(click).toHaveBeenCalledOnce();
    });
  });

  it("keeps failed startup retryable without replaying the lost click", async () => {
    const frames: FrameRequestCallback[] = [];
    const listeners = new Map<string, EventListener>();
    const timers: Array<{ callback: () => void; delay: number }> = [];
    let resolveClient: (() => void) | undefined;
    const clientReady = new Promise<void>((resolve) => {
      resolveClient = resolve;
    });
    const loadClient = vi
      .fn<() => Promise<{ clientReady?: Promise<unknown> }>>()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce({ clientReady });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const button = document.createElement("button");
    document.body.append(button);
    const click = vi.spyOn(button, "click");
    const browserWindow = {
      addEventListener: vi.fn(
        (eventName: string, listener: EventListenerOrEventListenerObject) => {
          listeners.set(eventName, listener as EventListener);
        }
      ),
      removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
      setTimeout: vi.fn((callback: () => void, delay: number) => {
        timers.push({ callback, delay });
        return timers.length;
      }),
    };
    const deferredClick = () => {
      const event = {
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
        target: button,
      } as unknown as MouseEvent;
      listeners.get("click")?.(event);
      return event;
    };

    scheduleDeferredStartup({
      document: snapshotDocument((element) => element === button),
      loadClient,
      loadSentry: () => Promise.resolve({ startSentry: vi.fn() }),
      window: browserWindow as never,
    });
    frames.shift()?.(0);
    frames.shift()?.(16);

    listeners.get("pointerdown")?.(new Event("pointerdown"));
    const failedClick = deferredClick();
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "Ferry FYI client startup failed",
        expect.any(Error)
      );
    });
    expect(failedClick.preventDefault).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();

    const recoveryTimers = timers.filter(({ delay }) => delay === 5_000);
    expect(recoveryTimers).toHaveLength(1);
    const recoveryTimer = recoveryTimers.at(-1);
    expect(recoveryTimer).toBeDefined();
    recoveryTimer?.callback();
    const retriedClick = deferredClick();
    expect(loadClient).toHaveBeenCalledTimes(2);
    resolveClient?.();
    await clientReady;

    await vi.waitFor(() => {
      expect(click).toHaveBeenCalledOnce();
    });
    expect(retriedClick.preventDefault).toHaveBeenCalledOnce();
  });

  it.each(["callback", "private", "disabled", "failure"])(
    "starts %s documents immediately",
    (documentMode) => {
      const frames: FrameRequestCallback[] = [];
      const loadClient = vi.fn(() => Promise.resolve({}));
      const browserWindow = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
          frames.push(callback);
          return frames.length;
        }),
        setTimeout: vi.fn(() => 1),
      };

      scheduleDeferredStartup({
        document: {
          querySelector: () => ({
            getAttribute: () => documentMode,
            hasChildNodes: () => false,
          }),
          readyState: "complete",
        } as unknown as Document,
        loadClient,
        loadSentry: () => Promise.resolve({ startSentry: vi.fn() }),
        window: browserWindow as never,
      });

      expect(loadClient).toHaveBeenCalledOnce();
      expect(frames).toHaveLength(1);
    }
  );
});
