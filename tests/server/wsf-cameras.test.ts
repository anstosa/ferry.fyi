import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// isolate camera logging from unrelated terminal models
vi.mock("~/lib/logging", () => ({
  formatLogBlock: vi.fn(),
  formatTerminalList: vi.fn(),
}));

// suppress fixture-only refresh logs
vi.mock("~/lib/logger", () => ({
  default: { error: vi.fn(), info: vi.fn() },
}));

import { updateCameras } from "../../server/lib/wsf/updateCameras";
import { Camera } from "../../server/models/Camera";
import {
  createPublicSsrSnapshotLoader,
  type PublicSsrSnapshotServices,
} from "../../server/ssr/publicSnapshot";

// exercise the camera path through the real WSF request boundary
describe("WSF camera refresh", () => {
  const fetchMock = vi.fn();

  // reset the in-memory catalog and network fixture
  beforeEach(() => {
    Camera.purge();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  // restore the network and catalog after each refresh
  afterEach(() => {
    vi.unstubAllGlobals();
    Camera.purge();
  });

  // retain reviewed camera metadata through creation and subsequent refreshes
  it("keeps configured capacity and display order over upstream defaults", async () => {
    const feed = JSON.stringify({
      FeedContentList: [
        {
          TerminalID: 7,
          FerryCamera: {
            CamID: 9035,
            ImgHeight: 480,
            ImgURL: "https://images.wsdot.wa.gov/ferry-test.jpg",
            ImgWidth: 640,
            IsActive: true,
            Lat: 47.6,
            Lon: -122.34,
            Title: "upstream holding camera",
          },
        },
      ],
    });
    fetchMock
      .mockResolvedValueOnce(new Response(feed))
      .mockResolvedValueOnce(new Response(feed));
    await updateCameras();
    expect(Camera.getByIndex("9035")?.serialize()).toMatchObject({
      carCapacity: 650,
      carsToBoat: null,
      orderFromTerminal: 1,
      title: "Holding",
    });
    await updateCameras();
    expect(Camera.getByIndex("9035")?.serialize()).toMatchObject({
      carCapacity: 650,
      carsToBoat: null,
      orderFromTerminal: 1,
      title: "Holding",
    });
  });

  // prevent unknown camera metadata from breaking public documents
  it("imports new cameras as complete SSR-safe records", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          FeedContentList: [
            {
              TerminalID: 7,
              FerryCamera: {
                CamID: 99999,
                ImgHeight: 480,
                ImgURL: "https://images.wsdot.wa.gov/ferry-test.jpg",
                ImgWidth: 640,
                IsActive: true,
                Lat: 47.6,
                Lon: -122.34,
                Title: "test terminal camera",
              },
            },
          ],
        })
      )
    );

    await updateCameras();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/www\.wsdot\.wa\.gov\/ferries\/vesselwatch\/Cameras\.ashx\?apiaccesscode=/
      ),
      expect.objectContaining({ method: "GET" })
    );
    expect(Camera.getByIndex("99999")).toMatchObject({
      carCapacity: null,
      carsToBoat: null,
      id: "99999",
      isActive: true,
      orderFromTerminal: Number.MAX_SAFE_INTEGER,
      terminalId: "7",
      title: "test terminal camera",
    });

    // use the freshly imported feed camera
    const discoveredCamera = Camera.getByIndex("99999")?.serialize();
    // build the smallest valid route pair
    const seattleIdentity = {
      abbreviation: "SEA",
      id: "7",
      name: "Seattle",
    };
    const bainbridgeIdentity = {
      abbreviation: "BBI",
      id: "3",
      name: "Bainbridge",
    };
    // supply a complete terminal projection
    const terminalBase = {
      bulletins: [],
      hasElevator: true,
      hasFood: true,
      hasOverheadLoading: true,
      hasRestroom: true,
      hasWaitingRoom: true,
      info: {},
      location: {
        address: {},
        latitude: 47.6,
        longitude: -122.34,
      },
      popularity: 1,
      routes: {},
      waitTimes: [],
    };
    // isolate unrelated public services
    const publicServices = {
      getAdCreative: vi.fn().mockResolvedValue(null),
      getCameraFrames: vi.fn(),
      getContent: vi.fn().mockResolvedValue({
        announcements: [],
        crawlerPolicy: { aiCrawlers: "allow", disallowPaths: [] },
        leaderboardIndexingEnabled: true,
        leaderboardSharingEnabled: true,
        maintenance: { enabled: false, message: "" },
      }),
      getFareCatalog: vi.fn(),
      getLeaderboard: vi.fn(),
      getPublicLeaderboardsEnabled: vi.fn(),
      getSchedule: vi.fn(),
      getTerminals: vi.fn().mockResolvedValue({
        "3": {
          ...terminalBase,
          ...bainbridgeIdentity,
          cameras: [],
          mates: [seattleIdentity],
        },
        "7": {
          ...terminalBase,
          ...seattleIdentity,
          cameras: [discoveredCamera],
          mates: [bainbridgeIdentity],
        },
      }),
      getVessels: vi.fn(),
      getWsfStatus: vi.fn(),
    } as unknown as PublicSsrSnapshotServices;
    // exercise strict snapshot validation
    const load = createPublicSsrSnapshotLoader({ services: publicServices });

    const result = await load({
      absoluteUrl: "https://ferry.fyi/seattle/terminal",
      contentRevision: "test",
      fixedClock: new Date("2026-10-06T21:00:00.000Z"),
      release: { publishedAt: null, version: "test" },
    });

    expect(result.classification).toBe("snapshot");
    expect(result.snapshot?.metadata).toMatchObject({
      canonicalPath: "/seattle/terminal",
      robots: "index,follow",
      title: "Seattle Ferry Terminal: Parking & Directions - Ferry FYI",
    });
  });
});
