import { beforeEach, describe, expect, it, vi } from "vitest";

const ticketLookupControl = vi.hoisted(() => ({
  findOrCreate: vi.fn(),
}));

vi.mock("~/models/TicketLookupControl", () => ({
  TicketLookupControl: ticketLookupControl,
}));

import {
  getTicketLookupSettings,
  getTicketLookupUserAgent,
  saveTicketLookupSettings,
} from "../../server/lib/wsf/ticketSettings";

// create a mutable control fixture
const makeControl = (userAgentProfile: string) => {
  const control = {
    // persist the profile in memory
    update: vi.fn(({ userAgentProfile: nextProfile }) => {
      control.userAgentProfile = nextProfile;
      return Promise.resolve(control);
    }),
    userAgentProfile,
  };
  return control;
};

describe("ticket lookup settings", () => {
  // reset model calls
  beforeEach(() => {
    ticketLookupControl.findOrCreate.mockReset();
  });

  // default singleton creation
  it("creates the singleton with the identified contact profile", async () => {
    const control = makeControl("identified-contact");
    ticketLookupControl.findOrCreate.mockResolvedValue([control, true]);

    const settings = await getTicketLookupSettings();

    expect(ticketLookupControl.findOrCreate).toHaveBeenCalledWith({
      defaults: {
        key: "wave2go",
        userAgentProfile: "identified-contact",
      },
      where: { key: "wave2go" },
    });
    expect(settings).toMatchObject({
      cacheTtlSeconds: 1_800,
      selectedUserAgentProfile: "identified-contact",
    });
  });

  // invalid persisted profile fallback
  it("falls back when the stored profile is no longer valid", async () => {
    ticketLookupControl.findOrCreate.mockResolvedValue([
      makeControl("browser-impersonation"),
      false,
    ]);

    await expect(getTicketLookupSettings()).resolves.toMatchObject({
      selectedUserAgentProfile: "identified-contact",
    });
  });

  // valid profile persistence
  it("saves a valid profile and returns the updated settings", async () => {
    const control = makeControl("identified-contact");
    ticketLookupControl.findOrCreate.mockResolvedValue([control, false]);

    const settings = await saveTicketLookupSettings({
      selectedUserAgentProfile: "identified-minimal",
    });

    expect(control.update).toHaveBeenCalledWith({
      userAgentProfile: "identified-minimal",
    });
    expect(settings.selectedUserAgentProfile).toBe("identified-minimal");
  });

  // invalid payload rejection
  it("rejects an invalid profile without reading or updating the control", async () => {
    await expect(
      saveTicketLookupSettings({
        selectedUserAgentProfile: "browser-impersonation",
      })
    ).rejects.toThrow("Invalid ticket lookup settings");

    expect(ticketLookupControl.findOrCreate).not.toHaveBeenCalled();
  });

  // selected user agent resolution
  it("returns the User-Agent for the selected profile", async () => {
    ticketLookupControl.findOrCreate.mockResolvedValue([
      makeControl("identified-product"),
      false,
    ]);

    await expect(getTicketLookupUserAgent()).resolves.toBe(
      "FerryFYI/1.0 (+https://ferry.fyi)"
    );
  });
});
