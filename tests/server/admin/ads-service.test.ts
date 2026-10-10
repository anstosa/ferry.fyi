import { beforeEach, describe, expect, it, vi } from "vitest";

const placements = vi.hoisted(() => ({
  findAll: vi.fn(),
  findOrCreate: vi.fn(),
}));
const controls = vi.hoisted(() => ({ findOrCreate: vi.fn() }));

vi.mock("~/models/AdPlacement", () => ({ AdPlacement: placements }));
vi.mock("~/models/SiteControl", () => ({ SiteControl: controls }));

import { saveAdPlacement } from "../../../server/lib/admin/ads";

const input = {
  advertiserName: " Island Coffee ",
  arrivalTerminalId: "7",
  body: " Open early. ",
  departureTerminalId: "3",
  enabled: true,
  headline: " Coffee nearby ",
  key: "schedule--3--7",
  slot: "schedule",
  targetUrl: "https://example.com/menu",
};

describe("admin ad persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controls.findOrCreate.mockResolvedValue([{ adsEnabled: true }]);
    placements.findAll.mockResolvedValue([]);
  });

  it("normalizes and persists a placement before returning the full configuration", async () => {
    const record = {
      ...input,
      update: vi.fn((value) => Promise.resolve(Object.assign(record, value))),
    };
    placements.findOrCreate.mockResolvedValue([record]);
    placements.findAll.mockImplementation(() => Promise.resolve([record]));

    await expect(saveAdPlacement(input.key, input)).resolves.toEqual({
      adsEnabled: true,
      placements: [
        {
          ...input,
          advertiserName: "Island Coffee",
          body: "Open early.",
          headline: "Coffee nearby",
        },
      ],
    });
    expect(record.update).toHaveBeenCalledWith(
      expect.objectContaining({
        advertiserName: "Island Coffee",
        arrivalTerminalId: "7",
        departureTerminalId: "3",
        targetUrl: "https://example.com/menu",
      })
    );
  });

  it("rejects non-HTTPS destinations and keys that do not match the direction", async () => {
    await expect(
      saveAdPlacement(input.key, {
        ...input,
        targetUrl: "http://example.com/menu",
      })
    ).rejects.toThrow("Invalid ad placement");
    await expect(saveAdPlacement("schedule--7--3", input)).rejects.toThrow(
      "Invalid ad placement"
    );
    expect(placements.findOrCreate).not.toHaveBeenCalled();
  });

  it("persists a navigation placement for one canonical departure terminal", async () => {
    const navigationInput = {
      ...input,
      arrivalTerminalId: null,
      key: "navigation--3",
      slot: "navigation",
    };
    const record = {
      ...navigationInput,
      update: vi.fn().mockResolvedValue(undefined),
    };
    placements.findOrCreate.mockResolvedValue([record]);
    placements.findAll.mockResolvedValue([record]);

    await expect(
      saveAdPlacement(navigationInput.key, navigationInput)
    ).resolves.toMatchObject({
      placements: [
        expect.objectContaining({
          arrivalTerminalId: null,
          departureTerminalId: "3",
          key: "navigation--3",
          slot: "navigation",
        }),
      ],
    });
    expect(record.update).toHaveBeenCalledWith(
      expect.objectContaining({
        arrivalTerminalId: null,
        departureTerminalId: "3",
        slot: "navigation",
      })
    );
  });

  it("rejects malformed and mismatched navigation placements", async () => {
    await expect(
      saveAdPlacement("navigation--3--7", {
        ...input,
        key: "navigation--3--7",
        slot: "navigation",
      })
    ).rejects.toThrow("Invalid ad placement");
    await expect(
      saveAdPlacement("navigation--9999", {
        ...input,
        arrivalTerminalId: null,
        key: "navigation--9999",
        slot: "navigation",
      })
    ).rejects.toThrow("Invalid ad placement");
    await expect(
      saveAdPlacement("navigation--3", {
        ...input,
        key: "navigation--3",
        slot: "navigation",
      })
    ).rejects.toThrow("Invalid ad placement");
    expect(placements.findOrCreate).not.toHaveBeenCalled();
  });
});
