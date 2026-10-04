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

  // prevent the camera origin from blocking startup refreshes
  it("uses the canonical allowed WSF origin and imports the feed", async () => {
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
      id: "99999",
      isActive: true,
      terminalId: "7",
      title: "test terminal camera",
    });
  });
});
