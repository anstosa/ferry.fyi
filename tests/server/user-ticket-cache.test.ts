import { beforeEach, describe, expect, it, vi } from "vitest";

const model = vi.hoisted(() => ({
  destroy: vi.fn(),
  findOne: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("~/models/UserTicket", () => ({ UserTicket: model }));

import {
  deleteUnsavedUserTickets,
  deleteUserTicket,
  readUserTicket,
  writeUserTicket,
} from "../../server/lib/wsf/userTicketCache";

const ticket = {
  description: "Seattle / Bainbridge",
  id: "ticket-1",
  name: "Adult ticket",
  plu: "",
  price: "$10.00",
  status: "Valid",
  usesRemaining: 1,
};

describe("account ticket persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a fresh record for only the requested subject and ticket", async () => {
    model.findOne.mockResolvedValue({
      sourceUpdatedAt: new Date("2026-08-05T12:00:00.000Z"),
      ticketData: ticket,
    });

    await expect(
      readUserTicket(
        "auth0|person",
        "ticket-1",
        1_800,
        Date.parse("2026-08-05T12:10:00.000Z")
      )
    ).resolves.toEqual({
      fresh: true,
      sourceUpdatedAt: Date.parse("2026-08-05T12:00:00.000Z") / 1_000,
      ticket,
    });
    expect(model.findOne).toHaveBeenCalledWith({
      where: { subject: "auth0|person", ticketId: "ticket-1" },
    });
  });

  it("marks a stale record for upstream-refresh fallback", async () => {
    model.findOne.mockResolvedValue({
      sourceUpdatedAt: new Date("2026-08-05T12:00:00.000Z"),
      ticketData: ticket,
    });

    await expect(
      readUserTicket(
        "auth0|person",
        "ticket-1",
        1_800,
        Date.parse("2026-08-05T12:30:00.000Z")
      )
    ).resolves.toEqual({
      fresh: false,
      sourceUpdatedAt: Date.parse("2026-08-05T12:00:00.000Z") / 1_000,
      ticket,
    });
  });

  it("upserts the latest successful result and supports scoped deletion", async () => {
    const result = {
      sourceUpdatedAt: Date.parse("2026-08-05T12:00:00.000Z") / 1_000,
      ticket,
    };

    await writeUserTicket("auth0|person", "ticket-1", result);
    await deleteUserTicket("auth0|person", "ticket-1");
    await deleteUnsavedUserTickets("auth0|person", ["ticket-1", "ticket-2"]);

    expect(model.upsert).toHaveBeenCalledWith({
      sourceUpdatedAt: new Date("2026-08-05T12:00:00.000Z"),
      subject: "auth0|person",
      ticketData: ticket,
      ticketId: "ticket-1",
    });
    expect(model.destroy).toHaveBeenCalledWith({
      where: { subject: "auth0|person", ticketId: "ticket-1" },
    });
    const unsavedWhere = model.destroy.mock.calls.at(-1)?.[0].where;
    const operator = Object.getOwnPropertySymbols(unsavedWhere.ticketId)[0];
    expect(unsavedWhere.subject).toBe("auth0|person");
    expect(unsavedWhere.ticketId[operator]).toEqual(["ticket-1", "ticket-2"]);
  });

  // verify empty saved-ticket cleanup
  it("deletes every persisted ticket for the subject when none remain saved", async () => {
    await deleteUnsavedUserTickets("auth0|person", []);

    expect(model.destroy).toHaveBeenCalledWith({
      where: { subject: "auth0|person" },
    });
  });
});
