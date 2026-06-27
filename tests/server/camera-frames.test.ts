import { describe, expect, it, vi } from "vitest";

import { CameraFrameTracker } from "../../server/lib/cameraFrames";

const camera = {
  id: "9048",
  image: { url: "https://example.com/camera.jpg" },
};

// build HEAD response
const headResponse = (headers: Record<string, string>): Response =>
  new Response(null, { headers, status: 200 });

// format unix seconds
const httpDate = (seconds: number): string =>
  new Date(seconds * 1000).toUTCString();

// backend camera frame tracking

describe("CameraFrameTracker", () => {
  // duplicate request guard
  it("shares in-flight and recent HEAD checks", async () => {
    let nowMs = 100_000;
    let resolveFetch!: (response: Response) => void;
    const fetchImpl = vi.fn(() => {
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    const tracker = new CameraFrameTracker({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getNowMs: () => nowMs,
      minCheckIntervalMs: 9500,
    });

    const first = tracker.getStatuses([camera]);
    const second = tracker.getStatuses([camera]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveFetch(
      headResponse({
        etag: '"a"',
        "last-modified": httpDate(99),
      })
    );

    expect(await first).toEqual(await second);

    nowMs += 1000;
    await tracker.getStatuses([camera]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // stale threshold guard
  it("marks frames stale after five minutes without an update", async () => {
    const nowMs = 10 * 60 * 1000;
    const fetchImpl = vi.fn().mockResolvedValue(
      headResponse({
        etag: '"old"',
        "last-modified": httpDate(4 * 60),
      })
    );
    const tracker = new CameraFrameTracker({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getNowMs: () => nowMs,
    });

    const statuses = await tracker.getStatuses([camera]);

    expect(statuses["9048"]?.isStale).toBe(true);
  });

  // token-only freshness guard
  it("uses first-seen time when validators change without Last-Modified", async () => {
    let nowMs = 1000 * 1000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(headResponse({ etag: '"a"' }))
      .mockResolvedValueOnce(headResponse({ etag: '"a"' }))
      .mockResolvedValueOnce(headResponse({ etag: '"b"' }));
    const tracker = new CameraFrameTracker({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getNowMs: () => nowMs,
      minCheckIntervalMs: 9500,
    });

    const first = await tracker.getStatuses([camera]);
    nowMs += 10_000;
    const second = await tracker.getStatuses([camera]);
    nowMs += 10_000;
    const third = await tracker.getStatuses([camera]);

    expect(first["9048"]?.frameUpdatedAt).toBe(1000);
    expect(second["9048"]?.frameUpdatedAt).toBe(1000);
    expect(third["9048"]?.frameUpdatedAt).toBe(1020);
  });
});
