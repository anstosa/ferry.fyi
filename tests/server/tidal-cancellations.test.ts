import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchTidalCancellations,
  getTidalCancellationsForDate,
  parseTidalCancellations,
  resetTidalCancellationCache,
} from "../../server/lib/wsf/tidalCancellations";

const toSeconds = (input: string): number =>
  DateTime.fromISO(input, { zone: "America/Los_Angeles" }).toSeconds();

const fixtureHtml = `
<html>
  <body>
    <div class="leftnavbox">
      <h4 class="header greyBg">June 2026</h4>
      <table>
        <tr class="addcancelcontent">
          <td><span>Fri 06/26</span></td>
          <td>
            <span>
              <div><div class="am">&nbsp;&nbsp;6:30</div> <span>1</span></div>
            </span>
          </td>
          <td>
            <span>
              <div><div class="am">&nbsp;&nbsp;7:15</div> <span>1</span></div>
            </span>
          </td>
          <td></td>
          <td></td>
        </tr>
        <tr class="addcancelcontentseparator">
          <td><span>Sat 06/27</span></td>
          <td>
            <span>
              <div><div class="pm">10:00</div> <span>2</span></div>
            </span>
          </td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
      </table>
    </div>
    <div class="leftnavbox">
      <h4>Legend</h4>
      <table>
        <tr>
          <td><span id="cphPageTemplate_rprVesselsAndPositions_lblVesselPositionNum_0">1</span></td>
          <td><a id="cphPageTemplate_rprVesselsAndPositions_hylVessel_0" href="https://www.wsdot.wa.gov/ferries/your_wsf/our_fleet/index.cfm?vessel_id=66">Salish</a></td>
        </tr>
        <tr>
          <td><span id="cphPageTemplate_rprVesselsAndPositions_lblVesselPositionNum_1">2</span></td>
          <td><a id="cphPageTemplate_rprVesselsAndPositions_hylVessel_1" href="https://www.wsdot.wa.gov/ferries/your_wsf/our_fleet/index.cfm?vessel_id=52">Kennewick</a></td>
        </tr>
      </table>
    </div>
  </body>
</html>`;

describe("tidal cancellation ingestion", () => {
  // reset fetch cache
  beforeEach(() => {
    resetTidalCancellationCache();
    vi.restoreAllMocks();
  });

  // table parser
  it("parses PT/Coupeville cancellation rows with vessels", () => {
    const cancellations = parseTidalCancellations(fixtureHtml);

    expect(cancellations).toEqual([
      {
        arrivalId: "11",
        departureId: "17",
        departureTime: toSeconds("2026-06-26T06:30:00"),
        vesselId: "66",
        vesselName: "Salish",
        vesselPosition: 1,
      },
      {
        arrivalId: "17",
        departureId: "11",
        departureTime: toSeconds("2026-06-26T07:15:00"),
        vesselId: "66",
        vesselName: "Salish",
        vesselPosition: 1,
      },
      {
        arrivalId: "11",
        departureId: "17",
        departureTime: toSeconds("2026-06-27T22:00:00"),
        vesselId: "52",
        vesselName: "Kennewick",
        vesselPosition: 2,
      },
    ]);
  }, 30_000);

  // date filter
  it("filters fetched cancellations by route and service date", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(fixtureHtml),
    } as Response);

    const cancellations = await getTidalCancellationsForDate(
      "2026-06-26",
      "17",
      "11"
    );
    const skippedRoute = await getTidalCancellationsForDate(
      "2026-06-26",
      "1",
      "2"
    );

    expect(cancellations).toEqual([
      expect.objectContaining({
        departureId: "17",
        departureTime: toSeconds("2026-06-26T06:30:00"),
      }),
    ]);
    expect(skippedRoute).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  // fetch de-duping
  it("shares concurrent fetches", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(fixtureHtml),
    } as Response);

    await Promise.all([fetchTidalCancellations(), fetchTidalCancellations()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });
});
