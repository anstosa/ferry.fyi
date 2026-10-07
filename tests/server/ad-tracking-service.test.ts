import { beforeEach, describe, expect, it, vi } from "vitest";
import { Op } from "sequelize";

const database = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
const campaigns = vi.hoisted(() => ({ findByPk: vi.fn(), findOne: vi.fn() }));
const exposures = vi.hoisted(() => ({ create: vi.fn(), findOne: vi.fn() }));
const placements = vi.hoisted(() => ({ findOrCreate: vi.fn() }));
const controls = vi.hoisted(() => ({ findOrCreate: vi.fn() }));

vi.mock("~/lib/db", () => ({ db: database }));
vi.mock("~/models/AdCampaign", () => ({ AdCampaign: campaigns }));
vi.mock("~/models/AdMeasurementExposure", () => ({
  AdMeasurementExposure: exposures,
}));
vi.mock("~/models/AdPlacement", () => ({ AdPlacement: placements }));
vi.mock("~/models/SiteControl", () => ({ SiteControl: controls }));

import {
  claimAdExposure,
  cleanupExpiredAdExposures,
  getPublicAdServingFingerprint,
  getPublicAdServingState,
  getServableAdCreative,
  issueAdExposure,
  resolveAdClick,
} from "../../server/services/public/adTracking";

const transaction = { LOCK: { UPDATE: "UPDATE" } };

describe("first-party ad measurement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AD_MEASUREMENT_ENABLED;
    database.transaction.mockImplementation(
      async (callback) => await callback(transaction)
    );
    database.query.mockResolvedValue([[], 1]);
    placements.findOrCreate.mockResolvedValue([
      { enabled: true, key: "schedule--3--7" },
    ]);
    controls.findOrCreate.mockResolvedValue([{ adsEnabled: true }]);
  });

  it("issues a hashed ephemeral exposure without incrementing aggregates", async () => {
    campaigns.findOne.mockResolvedValue(null);
    exposures.create.mockResolvedValue({});

    const result = await issueAdExposure(
      "schedule--3--7",
      new Date("2026-08-05T06:59:00.000Z")
    );

    expect(result.creative).toBeNull();
    expect(result.token).toMatch(/^adx_[A-Za-z0-9_-]{43}$/);
    expect(exposures.create).toHaveBeenCalledWith(
      expect.objectContaining({
        businessDate: "2026-08-04",
        businessHour: 23,
        campaignId: null,
        servable: false,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
    expect(database.query).not.toHaveBeenCalled();
  });

  it("binds a paused scheduled campaign but exposes no creative", async () => {
    controls.findOrCreate.mockResolvedValue([{ adsEnabled: false }]);
    campaigns.findOne.mockResolvedValue({ id: "campaign" });
    exposures.create.mockResolvedValue({});

    const result = await issueAdExposure("schedule--3--7");

    expect(result.creative).toBeNull();
    expect(exposures.create).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "campaign", servable: false })
    );
  });

  it("resolves cache-safe creative content without issuing an exposure", async () => {
    campaigns.findOne.mockResolvedValue({
      advertiserName: "Island Coffee",
      body: "Coffee near the dock.",
      headline: "Fuel up before sailing",
      id: "campaign",
      placementKey: "schedule--3--7",
      targetUrl: "https://example.com/menu",
    });

    await expect(
      getServableAdCreative(
        "schedule--3--7",
        new Date("2026-08-04T12:00:00.000Z")
      )
    ).resolves.toMatchObject({
      advertiserName: "Island Coffee",
      campaignId: "campaign",
      placementKey: "schedule--3--7",
    });
    expect(exposures.create).not.toHaveBeenCalled();
  });

  it("fingerprints the effective public creative in stable field order", async () => {
    campaigns.findOne.mockResolvedValue({
      advertiserName: "Island Coffee",
      body: "Coffee near the dock.",
      headline: "Fuel up before sailing",
      id: "campaign",
      placementKey: "schedule--3--7",
      targetUrl: "https://example.com/menu",
    });

    const state = await getPublicAdServingState(
      "schedule--3--7",
      new Date("2026-08-04T12:00:00.000Z")
    );

    expect(state.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(state.fingerprint).toBe(
      getPublicAdServingFingerprint("schedule--3--7", state.creative)
    );
    expect(getPublicAdServingFingerprint("schedule--3--7", null)).not.toBe(
      state.fingerprint
    );
  });

  it("uses inclusive starts and exclusive end boundaries for every fresh decision", async () => {
    const now = new Date("2026-08-04T12:00:00.000Z");
    campaigns.findOne.mockResolvedValue(null);

    await getPublicAdServingState("schedule--3--7", now);

    const query = campaigns.findOne.mock.calls[0][0];
    expect(query.where.startsAt[Op.lte]).toBe(now);
    expect(query.where.endsAt[Op.gt]).toBe(now);
    expect(query.where[Op.or]).toEqual([
      { endedEarlyAt: null },
      { endedEarlyAt: { [Op.gt]: now } },
    ]);
  });

  it("fingerprints the environment kill switch without database access", async () => {
    process.env.AD_MEASUREMENT_ENABLED = "false";

    const state = await getPublicAdServingState(
      "schedule--3--7",
      new Date("2026-08-04T12:00:00.000Z")
    );

    expect(state.creative).toBeNull();
    expect(state.fingerprint).toBe(
      getPublicAdServingFingerprint("schedule--3--7", null)
    );
    expect(campaigns.findOne).not.toHaveBeenCalled();
    expect(placements.findOrCreate).not.toHaveBeenCalled();
    expect(controls.findOrCreate).not.toHaveBeenCalled();
  });

  it("changes fingerprints only when the effective public serving state changes", async () => {
    campaigns.findOne.mockResolvedValue({
      advertiserName: "Island Coffee",
      body: "Coffee near the dock.",
      headline: "Fuel up before sailing",
      id: "campaign-A",
      placementKey: "schedule--3--7",
      targetUrl: "https://example.com/menu",
    });
    const enabled = await getPublicAdServingState("schedule--3--7");
    controls.findOrCreate.mockResolvedValue([{ adsEnabled: false }]);
    const globallyDisabled = await getPublicAdServingState("schedule--3--7");
    controls.findOrCreate.mockResolvedValue([{ adsEnabled: true }]);
    placements.findOrCreate.mockResolvedValue([
      { enabled: false, key: "schedule--3--7" },
    ]);
    const placementDisabled = await getPublicAdServingState("schedule--3--7");

    expect(enabled.creative).toMatchObject({ campaignId: "campaign-A" });
    expect(globallyDisabled.creative).toBeNull();
    expect(placementDisabled.creative).toBeNull();
    expect(globallyDisabled.fingerprint).toBe(placementDisabled.fingerprint);
    expect(enabled.fingerprint).not.toBe(globallyDisabled.fingerprint);
  });

  it("rejects malformed campaign ids before querying Postgres", async () => {
    await expect(
      resolveAdClick({ campaignId: "not-a-uuid", token: "adx_example" })
    ).resolves.toBeNull();

    expect(campaigns.findByPk).not.toHaveBeenCalled();
  });

  it("rejects delivery claims for a paused exposure", async () => {
    exposures.findOne.mockResolvedValue({
      campaignId: "campaign",
      servable: false,
      viewableClaimed: false,
    });

    await claimAdExposure("adx_example", "viewable");

    expect(database.query).not.toHaveBeenCalled();
  });

  it("atomically fills served when accepting the first viewable claim", async () => {
    const exposure = {
      businessDate: "2026-08-04",
      businessHour: 23,
      campaignId: "campaign",
      servable: true,
      servedClaimed: false,
      update: vi.fn(),
      viewableClaimed: false,
    };
    exposures.findOne.mockResolvedValue(exposure);

    await claimAdExposure("adx_example", "viewable");

    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('"servedCount"'),
      expect.objectContaining({
        replacements: expect.objectContaining({ served: 1, viewable: 1 }),
        transaction,
      })
    );
    expect(exposure.update).toHaveBeenCalledWith(
      { servedClaimed: true, viewableClaimed: true },
      { transaction }
    );
  });

  it("records paused campaign opportunity separately from delivery", async () => {
    const exposure = {
      businessDate: "2026-08-04",
      businessHour: 23,
      campaignId: "campaign",
      opportunityClaimed: false,
      placementKey: "schedule--3--7",
      servable: false,
      update: vi.fn(),
    };
    exposures.findOne.mockResolvedValue(exposure);

    await claimAdExposure("adx_example", "opportunity");

    expect(database.query).toHaveBeenCalledTimes(2);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "AdPlacementHourlyMetrics"'),
      expect.objectContaining({
        replacements: expect.objectContaining({ businessHour: 23 }),
        transaction,
      })
    );
    expect(exposure.update).toHaveBeenCalledWith(
      { opportunityClaimed: true },
      { transaction }
    );
  });

  it("returns the exact bounded cleanup batch size", async () => {
    database.query.mockResolvedValue([{ tokenHash: "a" }, { tokenHash: "b" }]);

    await expect(cleanupExpiredAdExposures(2)).resolves.toBe(2);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("FOR UPDATE SKIP LOCKED"),
      expect.objectContaining({ replacements: { limit: 2 } })
    );
  });
});
