// @vitest-environment jsdom

import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("~/lib/api", () => api);

import {
  getVesselSnapshot,
  refreshVessels,
  useLiveVessels,
} from "../../client/lib/vessels";

let root: Root | undefined;
let visibilityState: DocumentVisibilityState = "visible";

Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => visibilityState,
});

const vessel = { id: "1", name: "Tacoma" };
const snapshot = {
  sourceUpdatedAt: 2_000_000_000,
  vessels: { "1": vessel },
};

const Probe = (): ReactElement => {
  useLiveVessels(true, 60_000);
  return React.createElement("div");
};

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  visibilityState = "visible";
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("vessel polling", () => {
  it("returns a forced fleet refresh in one API request", async () => {
    api.post.mockResolvedValue(snapshot);

    await expect(refreshVessels()).resolves.toEqual({
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      vessels: [vessel],
    });

    expect(api.post).toHaveBeenCalledOnce();
    expect(api.post).toHaveBeenCalledWith("/vessels/refresh", {});
    expect(api.get).not.toHaveBeenCalled();
  });

  it("removes vessels omitted from a newer full-fleet snapshot", async () => {
    const retiredVessel = { id: "2", name: "Retired" };
    api.get
      .mockResolvedValueOnce({
        ...snapshot,
        vessels: { "1": vessel, "2": retiredVessel },
      })
      .mockResolvedValueOnce(snapshot);

    const first = await getVesselSnapshot();
    expect(first.vessels).toHaveLength(2);
    expect(first.vessels).toEqual(expect.arrayContaining([vessel, retiredVessel]));
    await expect(getVesselSnapshot()).resolves.toMatchObject({
      vessels: [vessel],
    });
  });

  it("polls the fleet once per minute and pauses while hidden", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    api.get.mockResolvedValue(snapshot);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(Probe));
      await Promise.resolve();
    });
    expect(api.get).toHaveBeenCalledOnce();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(api.get).toHaveBeenCalledTimes(2);

    visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
      await Promise.resolve();
    });
    expect(api.get).toHaveBeenCalledTimes(2);

    visibilityState = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.get).toHaveBeenLastCalledWith("/vessels/snapshot");
  });
});
