import { beforeEach, describe, expect, it, vi } from "vitest";

const upstream = vi.hoisted(() => ({ fetchTicket: vi.fn() }));
const settings = vi.hoisted(() => ({
  getTicketLookupUserAgent: vi.fn(() => Promise.resolve("FerryFYI/1.0")),
  TICKET_LOOKUP_CACHE_TTL_SECONDS: 1_800,
}));
const userCache = vi.hoisted(() => ({
  deleteUserTicket: vi.fn(),
  readUserTicket: vi.fn(),
  writeUserTicket: vi.fn(),
}));

vi.mock("~/lib/wsf/ticket", () => ({
  ...upstream,
  TicketLookupUnavailableError: class extends Error {},
}));
vi.mock("~/lib/wsf/ticketSettings", () => settings);
vi.mock("~/lib/wsf/userTicketCache", () => userCache);

import { TicketLookupUnavailableError } from "../../server/lib/wsf/ticket";
import {
  forgetTicket,
  lookupTicket,
  resetTicketLookupRuntime,
} from "../../server/lib/wsf/ticketLookup";

const ticket = (id: string) => ({
  description: "",
  id,
  name: "Adult ticket",
  plu: "",
  price: "$10.00",
  status: "Valid",
  usesRemaining: 1,
});

describe("ticket lookup coordination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    userCache.readUserTicket.mockResolvedValue(undefined);
    userCache.writeUserTicket.mockResolvedValue(undefined);
    userCache.deleteUserTicket.mockResolvedValue(undefined);
    resetTicketLookupRuntime();
  });

  it("caches successful lookups with their original freshness timestamp", async () => {
    upstream.fetchTicket.mockResolvedValue(ticket("ticket-1"));

    const first = await lookupTicket("ticket-1");
    vi.mocked(Date.now).mockReturnValue(1_800_000_060_000);
    const second = await lookupTicket("ticket-1");

    expect(upstream.fetchTicket).toHaveBeenCalledTimes(1);
    expect(first.sourceUpdatedAt).toBe(1_800_000_000);
    expect(second).toEqual(first);
  });

  // verify expired cache refresh
  it("refetches a cached ticket after its cache lifetime expires", async () => {
    upstream.fetchTicket.mockResolvedValue(ticket("ticket-1"));

    const first = await lookupTicket("ticket-1");
    vi.mocked(Date.now).mockReturnValue(1_800_001_800_000);
    const refreshed = await lookupTicket("ticket-1");

    expect(upstream.fetchTicket).toHaveBeenCalledTimes(2);
    expect(first.sourceUpdatedAt).toBe(1_800_000_000);
    expect(refreshed.sourceUpdatedAt).toBe(1_800_001_800);
  });

  it("runs upstream lookups one at a time across different tickets", async () => {
    let finishFirst: ((value: ReturnType<typeof ticket>) => void) | undefined;
    upstream.fetchTicket.mockImplementation((id: string) => {
      if (id === "ticket-1") {
        return new Promise((resolve) => {
          finishFirst = resolve;
        });
      }
      return Promise.resolve(ticket(id));
    });

    const first = lookupTicket("ticket-1");
    const second = lookupTicket("ticket-2");
    await vi.waitFor(() =>
      expect(upstream.fetchTicket).toHaveBeenCalledTimes(1)
    );
    expect(upstream.fetchTicket).toHaveBeenLastCalledWith("ticket-1", {
      userAgent: "FerryFYI/1.0",
    });

    finishFirst?.(ticket("ticket-1"));
    await expect(first).resolves.toMatchObject({ ticket: { id: "ticket-1" } });
    await expect(second).resolves.toMatchObject({ ticket: { id: "ticket-2" } });
    expect(upstream.fetchTicket).toHaveBeenCalledTimes(2);
  });

  // verify rejected queue recovery
  it("runs the next queued lookup after an earlier lookup rejects", async () => {
    const failure = new Error("lookup failed");
    upstream.fetchTicket
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(ticket("ticket-2"));

    const rejected = lookupTicket("ticket-1");
    const queued = lookupTicket("ticket-2");

    await expect(rejected).rejects.toBe(failure);
    await expect(queued).resolves.toMatchObject({ ticket: { id: "ticket-2" } });
    expect(upstream.fetchTicket).toHaveBeenNthCalledWith(2, "ticket-2", {
      userAgent: "FerryFYI/1.0",
    });
  });

  it("uses an account-scoped persisted result before calling upstream", async () => {
    const persisted = {
      fresh: true,
      sourceUpdatedAt: 1_799_999_900,
      ticket: ticket("ticket-1"),
    };
    userCache.readUserTicket.mockResolvedValue(persisted);

    await expect(lookupTicket("ticket-1", "auth0|person")).resolves.toEqual({
      sourceUpdatedAt: persisted.sourceUpdatedAt,
      ticket: persisted.ticket,
    });

    expect(userCache.readUserTicket).toHaveBeenCalledWith(
      "auth0|person",
      "ticket-1",
      1_800
    );
    expect(upstream.fetchTicket).not.toHaveBeenCalled();
  });

  it("persists successful authenticated lookups but not anonymous ones", async () => {
    upstream.fetchTicket.mockResolvedValue(ticket("ticket-1"));

    const authenticated = await lookupTicket("ticket-1", "auth0|person");
    await lookupTicket("ticket-1");

    expect(userCache.writeUserTicket).toHaveBeenCalledTimes(1);
    expect(userCache.writeUserTicket).toHaveBeenCalledWith(
      "auth0|person",
      "ticket-1",
      authenticated
    );
  });

  it("falls back to the last account result when an upstream refresh fails", async () => {
    const persisted = {
      fresh: false,
      sourceUpdatedAt: 1_799_000_000,
      ticket: ticket("ticket-1"),
    };
    userCache.readUserTicket.mockResolvedValue(persisted);
    upstream.fetchTicket.mockRejectedValue(
      new TicketLookupUnavailableError("upstream unavailable")
    );

    await expect(lookupTicket("ticket-1", "auth0|person")).resolves.toEqual({
      sourceUpdatedAt: persisted.sourceUpdatedAt,
      ticket: persisted.ticket,
    });
  });

  it("forgets only the selected account ticket", async () => {
    await forgetTicket("VisualID=ticket-1&foo=bar", "auth0|person");

    expect(userCache.deleteUserTicket).toHaveBeenCalledWith(
      "auth0|person",
      "ticket-1"
    );
  });
});
