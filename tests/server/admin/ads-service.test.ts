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
});
