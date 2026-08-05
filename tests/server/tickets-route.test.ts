import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => ({
  forgetTicket: vi.fn(),
  lookupTicket: vi.fn(),
}));

vi.mock("~/lib/wsf/ticketLookup", () => lookup);
vi.mock("~/lib/wsf/ticket", () => ({
  TicketLookupUnavailableError: class extends Error {
    status?: number;
  },
}));

import { ticketRouter } from "../../server/controllers/api/tickets";
import { TicketLookupUnavailableError } from "../../server/lib/wsf/ticket";

// create ticket route harness
const createApp = (): express.Express => {
  const app = express();
  app.use((request, response, next) => {
    if (request.get("Authorization") === "Bearer valid") {
      response.locals.user = { sub: "auth0|person" };
    }
    next();
  });
  app.use("/tickets", ticketRouter);
  // expose propagated route errors
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      response.status(599).send({
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  );
  return app;
};

describe("ticket API account persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookup.lookupTicket.mockResolvedValue({
      sourceUpdatedAt: 1_800_000_000,
      ticket: {
        description: "",
        id: "ticket-1",
        name: "Adult ticket",
        plu: "",
        price: "$10.00",
        status: "Valid",
        usesRemaining: 1,
      },
    });
    lookup.forgetTicket.mockResolvedValue(undefined);
  });

  it("keeps anonymous lookups public", async () => {
    await request(createApp()).get("/tickets/ticket-1").expect(200);

    expect(lookup.lookupTicket).toHaveBeenCalledWith("ticket-1", undefined);
  });

  it("scopes authenticated lookups to the validated subject", async () => {
    await request(createApp())
      .get("/tickets/ticket-1")
      .set("Authorization", "Bearer valid")
      .expect(200);

    expect(lookup.lookupTicket).toHaveBeenCalledWith(
      "ticket-1",
      "auth0|person"
    );
  });

  // verify missing ticket response
  it("returns not found when the lookup has no ticket", async () => {
    lookup.lookupTicket.mockResolvedValue({
      sourceUpdatedAt: 1_800_000_000,
      ticket: null,
    });

    await request(createApp())
      .get("/tickets/missing-ticket")
      .expect(404, { error: "ticket_not_found" });
  });

  // verify unavailable upstream response
  it("returns service unavailable for ticket lookup availability errors", async () => {
    const error = new TicketLookupUnavailableError("upstream unavailable");
    error.status = 429;
    lookup.lookupTicket.mockRejectedValue(error);

    await request(createApp()).get("/tickets/ticket-1").expect(503, {
      error: "ticket_lookup_unavailable",
      message: "upstream unavailable",
      status: 429,
    });
  });

  // verify unexpected error propagation
  it("propagates generic lookup errors to the application error handler", async () => {
    lookup.lookupTicket.mockRejectedValue(new Error("unexpected failure"));

    const response = await request(createApp()).get("/tickets/ticket-1");

    expect(response.status).toBe(599);
    expect(response.body.error).toBe("unexpected failure");
  });

  it("requires authentication before deleting persisted ticket data", async () => {
    await request(createApp()).delete("/tickets/ticket-1").expect(401);
    await request(createApp())
      .delete("/tickets/ticket-1")
      .set("Authorization", "Bearer valid")
      .expect(204);

    expect(lookup.forgetTicket).toHaveBeenCalledTimes(1);
    expect(lookup.forgetTicket).toHaveBeenCalledWith(
      "ticket-1",
      "auth0|person"
    );
  });
});
