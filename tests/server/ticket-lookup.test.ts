import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

const TICKET_LOOKUP_HTML = `
  <div id="TicketLookup">
    <span data-text="Description">Seattle / Bainbridge Multi-Ride</span>
    <span data-text="ExpirationDate">July 30, 2026</span>
    <span data-text="VisualId">1234567890</span>
    <span data-text="ItemName">Adult Multi-Ride Pass</span>
    <span data-text="Plu">ABC123</span>
    <span data-text="Price">$45.00</span>
    <span data-text="Status">Valid</span>
    <span data-text="TotalRemainingUses">10</span>
  </div>
`;

const TICKET_LOOKUP_WITHOUT_EXPIRATION_HTML = `
  <div id="TicketLookup">
    <span data-text="VisualId">1234567890</span>
    <span data-text="Price">$0.00</span>
    <span data-text="Status">Valid</span>
    <span data-text="TotalRemainingUses">1</span>
  </div>
`;

const execFileMock = vi.mocked(execFile);
let ticketModule: typeof import("../../server/lib/wsf/ticket");

type CurlMockResponse = {
  body: string;
  headers: string;
  status: number;
};

// curl response queue
const mockCurlResponses = (responses: CurlMockResponse[]): void => {
  execFileMock.mockImplementation(((_command, args, _options, callback) => {
    const response = responses.shift();

    // queued response guard
    if (!response) {
      throw new Error("Unexpected curl request");
    }

    const headerPath = (args as string[])[
      (args as string[]).indexOf("--dump-header") + 1
    ];
    writeFileSync(headerPath, response.headers);
    callback?.(
      null,
      `${response.body}__FERRY_FYI_CURL_STATUS__:${response.status}`,
      ""
    );
  }) as typeof execFile);
};

describe("Wave2Go ticket lookup", () => {
  // fresh module cache
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    ticketModule = await import("../../server/lib/wsf/ticket");
  }, 30_000);

  // QR URL lookup id behavior
  it("extracts visual IDs from QR URL payloads", () => {
    expect(
      ticketModule.getTicketLookupId(
        "https://wave2go.wsdot.com/webstore/account/ticketLookup.aspx?VisualID=1234567890"
      )
    ).toBe("1234567890");
  });

  // QR query lookup id behavior
  it("extracts visual IDs from raw QR query payloads", () => {
    expect(ticketModule.getTicketLookupId("VisualID=1234567890&foo=bar")).toBe(
      "1234567890"
    );
  });

  // QR URL lookup request behavior
  it("looks up multi-ride QR URL payloads by visual ID", async () => {
    mockCurlResponses([
      {
        body: "ok",
        headers: "HTTP/2 200\r\nset-cookie: session=test; path=/\r\n\r\n",
        status: 200,
      },
      {
        body: TICKET_LOOKUP_HTML,
        headers: "HTTP/2 200\r\n\r\n",
        status: 200,
      },
    ]);

    const ticket = await ticketModule.fetchTicket(
      "https://wave2go.wsdot.com/webstore/account/ticketLookup.aspx?VisualID=1234567890"
    );

    expect(execFileMock.mock.calls[1][1]).toContain(
      "https://wave2go.wsdot.com/webstore/account/ticketLookup.aspx?VisualID=1234567890"
    );
    expect(execFileMock.mock.calls[1][1]).toContain("Cookie: session=test");
    expect(ticket).toMatchObject({
      description: "Seattle / Bainbridge Multi-Ride",
      id: "1234567890",
      name: "Adult Multi-Ride Pass",
      usesRemaining: 10,
    });
  });

  // cookie reuse behavior
  it("reuses Wave2Go cookies across ticket lookups", async () => {
    mockCurlResponses([
      {
        body: "ok",
        headers: "HTTP/2 200\r\nset-cookie: session=test; path=/\r\n\r\n",
        status: 200,
      },
      {
        body: TICKET_LOOKUP_HTML,
        headers: "HTTP/2 200\r\n\r\n",
        status: 200,
      },
      {
        body: TICKET_LOOKUP_HTML,
        headers: "HTTP/2 200\r\n\r\n",
        status: 200,
      },
    ]);

    await ticketModule.fetchTicket("1234567890");
    await ticketModule.fetchTicket("1234567890");

    expect(execFileMock).toHaveBeenCalledTimes(3);
    expect(execFileMock.mock.calls[2][1]).toContain("Cookie: session=test");
  });

  // stale cookie behavior
  it("refreshes stale Wave2Go cookies once", async () => {
    mockCurlResponses([
      {
        body: "ok",
        headers: "HTTP/2 200\r\nset-cookie: session=old; path=/\r\n\r\n",
        status: 200,
      },
      {
        body: "blocked",
        headers: "HTTP/2 403\r\n\r\n",
        status: 403,
      },
      {
        body: "ok",
        headers: "HTTP/2 200\r\nset-cookie: session=new; path=/\r\n\r\n",
        status: 200,
      },
      {
        body: TICKET_LOOKUP_HTML,
        headers: "HTTP/2 200\r\n\r\n",
        status: 200,
      },
    ]);

    const ticket = await ticketModule.fetchTicket("1234567890");

    expect(execFileMock.mock.calls[3][1]).toContain("Cookie: session=new");
    expect(ticket).toMatchObject({
      description: "Seattle / Bainbridge Multi-Ride",
      id: "1234567890",
      name: "Adult Multi-Ride Pass",
      usesRemaining: 10,
    });
  });

  // identified user agent behavior
  it("identifies Ferry FYI instead of impersonating a browser", async () => {
    mockCurlResponses([
      {
        body: "ok",
        headers: "HTTP/2 200\r\nset-cookie: session=test; path=/\r\n\r\n",
        status: 200,
      },
      {
        body: TICKET_LOOKUP_HTML,
        headers: "HTTP/2 200\r\n\r\n",
        status: 200,
      },
    ]);

    await ticketModule.fetchTicket("1234567890");

    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args[args.indexOf("--user-agent") + 1]).toBe(
      "FerryFYI/1.0 (+https://ferry.fyi; dev@ferry.fyi)"
    );
    expect(args.join(" ")).not.toContain("Mozilla/5.0");
  });

  it("uses an explicitly selected truthful User-Agent", async () => {
    mockCurlResponses([
      {
        body: "ok",
        headers: "HTTP/2 200\r\nset-cookie: session=test; path=/\r\n\r\n",
        status: 200,
      },
      {
        body: TICKET_LOOKUP_HTML,
        headers: "HTTP/2 200\r\n\r\n",
        status: 200,
      },
    ]);

    await ticketModule.fetchTicket("1234567890", {
      userAgent: "FerryFYI/1.0",
    });

    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args[args.indexOf("--user-agent") + 1]).toBe("FerryFYI/1.0");
  });

  // incomplete lookup behavior
  it("returns null for incomplete ticket lookup pages", async () => {
    mockCurlResponses([
      {
        body: "ok",
        headers: "HTTP/2 200\r\nset-cookie: session=test; path=/\r\n\r\n",
        status: 200,
      },
      {
        body: `<div id="TicketLookup"><span data-text="VisualId">123</span></div>`,
        headers: "HTTP/2 200\r\n\r\n",
        status: 200,
      },
    ]);

    await expect(ticketModule.fetchTicket("123")).resolves.toBeNull();
  });

  // sparse ticket lookup behavior
  it("returns valid tickets without expiration or product metadata", async () => {
    mockCurlResponses([
      {
        body: "ok",
        headers: "HTTP/2 200\r\nset-cookie: session=test; path=/\r\n\r\n",
        status: 200,
      },
      {
        body: TICKET_LOOKUP_WITHOUT_EXPIRATION_HTML,
        headers: "HTTP/2 200\r\n\r\n",
        status: 200,
      },
    ]);

    await expect(ticketModule.fetchTicket("1234567890")).resolves.toEqual({
      description: "",
      expirationDate: undefined,
      id: "1234567890",
      name: "",
      plu: "",
      price: "$0.00",
      status: "Valid",
      usesRemaining: 1,
    });
  });

  // upstream failure behavior
  it("reports upstream landing-page failures as unavailable", async () => {
    mockCurlResponses([
      {
        body: "blocked",
        headers: "HTTP/2 403\r\n\r\n",
        status: 403,
      },
    ]);

    await expect(ticketModule.fetchTicket("123")).rejects.toBeInstanceOf(
      ticketModule.TicketLookupUnavailableError
    );
  });

  // anti-bot challenge behavior
  it("reports Cloudflare ticket pages as unavailable", async () => {
    mockCurlResponses([
      {
        body: "ok",
        headers: "HTTP/2 200\r\nset-cookie: session=test; path=/\r\n\r\n",
        status: 200,
      },
      {
        body: "<title>Just a moment...</title>",
        headers: "HTTP/2 200\r\n\r\n",
        status: 200,
      },
    ]);

    await expect(ticketModule.fetchTicket("123")).rejects.toBeInstanceOf(
      ticketModule.TicketLookupUnavailableError
    );
  });
});
