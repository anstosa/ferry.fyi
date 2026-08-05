import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  getTicketLookupSettings: vi.fn(),
  saveTicketLookupSettings: vi.fn(),
}));
const ticketLookup = vi.hoisted(() => ({
  resetTicketLookupRuntime: vi.fn(),
}));
vi.mock("~/lib/wsf/ticketSettings", () => settings);
vi.mock("~/lib/wsf/ticketLookup", () => ticketLookup);

import { getAdminConfirmationPhrase } from "../../../server/controllers/api/admin/confirmation";
import { adminTicketsRouter } from "../../../server/controllers/api/admin/tickets";

const configuration = {
  cacheTtlSeconds: 1_800,
  selectedUserAgentProfile: "identified-contact",
  userAgentProfiles: [
    {
      id: "identified-contact",
      label: "Ferry FYI with contact",
      userAgent: "FerryFYI/1.0 (+https://ferry.fyi; dev@ferry.fyi)",
    },
  ],
};
const app = (): express.Express => {
  const value = express();
  value.use(express.json());
  value.use("/tickets", adminTicketsRouter);
  return value;
};

describe("admin ticket lookup routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settings.getTicketLookupSettings.mockResolvedValue(configuration);
    settings.saveTicketLookupSettings.mockResolvedValue(configuration);
  });

  it("returns settings and requires typed confirmation to change them", async () => {
    await request(app()).get("/tickets").expect(200, configuration);
    await request(app())
      .put("/tickets/settings")
      .send({ selectedUserAgentProfile: "identified-minimal" })
      .expect(400);

    const target = "ticket-lookup:settings";
    await request(app())
      .put("/tickets/settings")
      .send({
        action: "save-ticket-lookup-settings",
        confirmation: getAdminConfirmationPhrase(
          "save-ticket-lookup-settings",
          target
        ),
        selectedUserAgentProfile: "identified-minimal",
        target,
      })
      .expect(200, configuration);
    expect(settings.saveTicketLookupSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedUserAgentProfile: "identified-minimal",
      })
    );
    expect(ticketLookup.resetTicketLookupRuntime).toHaveBeenCalledOnce();
  });

  // invalid save isolation
  it("returns 400 without resetting runtime when saving fails", async () => {
    settings.saveTicketLookupSettings.mockRejectedValueOnce(
      new Error("Invalid ticket lookup settings")
    );
    const target = "ticket-lookup:settings";

    await request(app())
      .put("/tickets/settings")
      .send({
        action: "save-ticket-lookup-settings",
        confirmation: getAdminConfirmationPhrase(
          "save-ticket-lookup-settings",
          target
        ),
        selectedUserAgentProfile: "browser-impersonation",
        target,
      })
      .expect(400, { error: "Invalid ticket lookup settings" });

    expect(ticketLookup.resetTicketLookupRuntime).not.toHaveBeenCalled();
  });
});
