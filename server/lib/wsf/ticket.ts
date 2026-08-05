// based on code donated by @jordansoltman, the developer for Ferry Friend on iOS

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JSDOM } from "jsdom";
import { DateTime } from "luxon";
import { Ticket } from "shared/contracts/tickets";
import { isKeyOf } from "shared/lib/objects";
import { getTicketLookupId } from "shared/lib/tickets";

const WAVE2GO_LANDING =
  "https://wave2go.wsdot.com/webstore/landingPage?cg=21&c=76";
const WAVE2GO_TICKET =
  "https://wave2go.wsdot.com/webstore/account/ticketLookup.aspx?VisualID=";
const CURL_STATUS_MARKER = "__FERRY_FYI_CURL_STATUS__:";
const CURL_TIMEOUT_SECONDS = "20";
const DEFAULT_USER_AGENT = "FerryFYI/1.0 (+https://ferry.fyi; dev@ferry.fyi)";
const WAVE2GO_REQUEST_HEADERS = [
  "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language: en-US,en;q=0.9",
];
let wsfSession: { cookie: string; userAgent: string } | null = null;

export class TicketLookupUnavailableError extends Error {
  status?: number;

  // lookup error details
  constructor(message: string, status?: number) {
    super(message);
    this.name = "TicketLookupUnavailableError";
    this.status = status;
  }
}

enum PROPERTY_BY_DATA {
  Description = "description",
  ExpirationDate = "expirationDate",
  VisualId = "id",
  ItemName = "name",
  Plu = "plu",
  Price = "price",
  Status = "status",
  TotalRemainingUses = "usesRemaining",
}

const isChallengePage = (html: string): boolean => {
  return /Just a moment|challenges\.cloudflare\.com|cf-browser-verification/i.test(
    html
  );
};

type CurlResponse = {
  body: string;
  headers: string;
  status: number;
};

// cookie cache setter
const setWsfCookie = (cookie: string, userAgent: string): string => {
  wsfSession = { cookie, userAgent };
  return cookie;
};

// curl execution wrapper
const execCurl = async (args: string[]): Promise<string> => {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      "curl",
      args,
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        // command failure guard
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.toString());
      }
    );
  });
};

// curl output parser
const parseCurlOutput = (stdout: string): { body: string; status: number } => {
  const markerIndex = stdout.lastIndexOf(CURL_STATUS_MARKER);

  // marker guard
  if (markerIndex === -1) {
    throw new TicketLookupUnavailableError("Wave2Go curl status was missing");
  }

  const body = stdout.slice(0, markerIndex);
  const status = Number(stdout.slice(markerIndex + CURL_STATUS_MARKER.length));

  // status guard
  if (!Number.isFinite(status)) {
    throw new TicketLookupUnavailableError("Wave2Go curl status was invalid");
  }

  return { body, status };
};

// cookie parser
const getCookieHeader = (headers: string): string => {
  return headers
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^set-cookie:\s*([^;]+)/i.exec(line);
      return match?.[1] ? [match[1]] : [];
    })
    .join("; ");
};

// Wave2Go curl request
const fetchWave2Go = async (
  url: string,
  headers: string[] = [],
  userAgent = DEFAULT_USER_AGENT
): Promise<CurlResponse> => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "ferry-fyi-wave2go-"));
  const headerPath = join(tempDirectory, "headers.txt");

  try {
    const stdout = await execCurl([
      "--silent",
      "--show-error",
      "--location",
      "--max-time",
      CURL_TIMEOUT_SECONDS,
      "--dump-header",
      headerPath,
      "--output",
      "-",
      "--write-out",
      `${CURL_STATUS_MARKER}%{http_code}`,
      "--user-agent",
      userAgent,
      ...WAVE2GO_REQUEST_HEADERS.flatMap((header) => ["--header", header]),
      ...headers.flatMap((header) => ["--header", header]),
      url,
    ]);
    const response = parseCurlOutput(stdout);
    const curlHeaders = await readFile(headerPath, "utf8");
    return { ...response, headers: curlHeaders };
  } catch (error) {
    // lookup error passthrough
    if (error instanceof TicketLookupUnavailableError) {
      throw error;
    }
    throw new TicketLookupUnavailableError("Wave2Go curl request failed");
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
};

// Wave2Go session cookie
const getWsfCookie = async (userAgent: string): Promise<string> => {
  // cached cookie guard
  if (wsfSession?.userAgent === userAgent) {
    return wsfSession.cookie;
  }

  wsfSession = null;
  const response = await fetchWave2Go(WAVE2GO_LANDING, [], userAgent);
  // upstream status guard
  if (response.status < 200 || response.status >= 300) {
    throw new TicketLookupUnavailableError(
      "Wave2Go landing page returned an error",
      response.status
    );
  }

  const cookie = getCookieHeader(response.headers);
  // cookie guard
  if (!cookie) {
    throw new TicketLookupUnavailableError(
      "Wave2Go landing page returned no cookie"
    );
  }
  return setWsfCookie(cookie, userAgent);
};

// ticket page fetcher
const fetchTicketPage = async (
  lookupId: string,
  userAgent: string
): Promise<CurlResponse> => {
  const cookie = await getWsfCookie(userAgent);
  const response = await fetchWave2Go(
    `${WAVE2GO_TICKET}${encodeURIComponent(lookupId)}`,
    [`Cookie: ${cookie}`, `Referer: ${WAVE2GO_LANDING}`],
    userAgent
  );

  // stale cookie guard
  if ((response.status === 401 || response.status === 403) && wsfSession) {
    wsfSession = null;
    const refreshedCookie = await getWsfCookie(userAgent);
    return await fetchWave2Go(
      `${WAVE2GO_TICKET}${encodeURIComponent(lookupId)}`,
      [`Cookie: ${refreshedCookie}`, `Referer: ${WAVE2GO_LANDING}`],
      userAgent
    );
  }

  return response;
};

export const fetchTicket = async (
  ticketId: string,
  { userAgent = DEFAULT_USER_AGENT }: { userAgent?: string } = {}
): Promise<Ticket | null> => {
  const lookupId = getTicketLookupId(ticketId);
  const response = await fetchTicketPage(lookupId, userAgent);
  // upstream status guard
  if (response.status < 200 || response.status >= 300) {
    throw new TicketLookupUnavailableError(
      "Wave2Go ticket lookup returned an error",
      response.status
    );
  }

  const html = response.body;
  // bot challenge guard
  if (isChallengePage(html)) {
    throw new TicketLookupUnavailableError(
      "Wave2Go ticket lookup is behind an anti-bot challenge",
      response.status
    );
  }

  const { window } = new JSDOM(html, {});

  const element = await window.document.querySelector("#TicketLookup");

  if (!element) {
    return null;
  }

  const spans = Array.from(element.querySelectorAll("span"));

  if (spans.length === 0) {
    return null;
  }

  const ticket: Record<string, string> = {};
  spans.forEach((span) => {
    const key = span.getAttribute("data-text");
    if (!key || !isKeyOf(PROPERTY_BY_DATA, key)) {
      return;
    }
    const value = span.textContent ?? "";
    const property = PROPERTY_BY_DATA[key];
    ticket[property] = value;
  });

  const expirationDate = ticket.expirationDate
    ? DateTime.fromFormat(ticket.expirationDate, "LLLL d, yyyy").toMillis()
    : undefined;
  const usesRemaining = Number(ticket.usesRemaining);

  // incomplete ticket guard
  if (
    !ticket.id ||
    !ticket.status ||
    (expirationDate !== undefined && !Number.isFinite(expirationDate)) ||
    !Number.isFinite(usesRemaining)
  ) {
    return null;
  }

  return {
    description: ticket.description ?? "",
    expirationDate,
    id: ticket.id,
    name: ticket.name ?? "",
    plu: ticket.plu ?? "",
    price: ticket.price ?? "",
    status: ticket.status,
    usesRemaining,
  };
};
