// based on code donated by @jordansoltman, the developer for Ferry Friend on iOS

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JSDOM } from "jsdom";
import { DateTime } from "luxon";
import { Ticket } from "shared/contracts/tickets";
import { isKeyOf } from "shared/lib/objects";

const WAVE2GO_LANDING =
  "https://wave2go.wsdot.com/webstore/landingPage?cg=21&c=76";
const WAVE2GO_TICKET =
  "https://wave2go.wsdot.com/webstore/account/ticketLookup.aspx?VisualID=";
const CURL_STATUS_MARKER = "__FERRY_FYI_CURL_STATUS__:";
const CURL_TIMEOUT_SECONDS = "20";
const WAVE2GO_BROWSER_HEADERS = [
  "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language: en-US,en;q=0.9",
  "Upgrade-Insecure-Requests: 1",
];
const TICKET_LOOKUP_ID_PARAMETERS = [
  "VisualID",
  "visualID",
  "visualId",
  "ticketId",
  "id",
];

let wsfCookie: string | null = null;

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

// test cache reset
export const resetTicketLookupSession = (): void => {
  wsfCookie = null;
};

// cookie cache setter
const setWsfCookie = (cookie: string): string => {
  wsfCookie = cookie;
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
  headers: string[] = []
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
      ...WAVE2GO_BROWSER_HEADERS.flatMap((header) => ["--header", header]),
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

// lookup id parser
export const getTicketLookupId = (ticketId: string): string => {
  const trimmedTicketId = ticketId.trim();

  // empty input guard
  if (!trimmedTicketId) {
    return ticketId;
  }

  try {
    const url = new URL(trimmedTicketId);

    // query id search
    for (const parameter of TICKET_LOOKUP_ID_PARAMETERS) {
      const value = url.searchParams.get(parameter)?.trim();

      // query value guard
      if (value) {
        return value;
      }
    }

    const pathSegments = url.pathname.split("/").filter(Boolean);
    const pathTicketId = pathSegments[pathSegments.length - 1];

    // path value guard
    if (pathTicketId) {
      return decodeURIComponent(pathTicketId);
    }
  } catch {}

  const searchParams = new URLSearchParams(trimmedTicketId);

  // raw query id search
  for (const parameter of TICKET_LOOKUP_ID_PARAMETERS) {
    const value = searchParams.get(parameter)?.trim();

    // raw query value guard
    if (value) {
      return value;
    }
  }

  return trimmedTicketId;
};

// Wave2Go session cookie
const getWsfCookie = async (): Promise<string> => {
  // cached cookie guard
  if (wsfCookie) {
    return wsfCookie;
  }

  const response = await fetchWave2Go(WAVE2GO_LANDING);
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
  return setWsfCookie(cookie);
};

// ticket page fetcher
const fetchTicketPage = async (lookupId: string): Promise<CurlResponse> => {
  const cookie = await getWsfCookie();
  const response = await fetchWave2Go(
    `${WAVE2GO_TICKET}${encodeURIComponent(lookupId)}`,
    [`Cookie: ${cookie}`, `Referer: ${WAVE2GO_LANDING}`]
  );

  // stale cookie guard
  if ((response.status === 401 || response.status === 403) && wsfCookie) {
    wsfCookie = null;
    const refreshedCookie = await getWsfCookie();
    return await fetchWave2Go(
      `${WAVE2GO_TICKET}${encodeURIComponent(lookupId)}`,
      [`Cookie: ${refreshedCookie}`, `Referer: ${WAVE2GO_LANDING}`]
    );
  }

  return response;
};

export const fetchTicket = async (ticketId: string): Promise<Ticket | null> => {
  const lookupId = getTicketLookupId(ticketId);
  const response = await fetchTicketPage(lookupId);
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
    : Number.NaN;
  const usesRemaining = Number(ticket.usesRemaining);

  // incomplete ticket guard
  if (
    !ticket.description ||
    !Number.isFinite(expirationDate) ||
    !ticket.id ||
    !ticket.name ||
    !ticket.plu ||
    !ticket.price ||
    !ticket.status ||
    !Number.isFinite(usesRemaining)
  ) {
    return null;
  }

  return {
    description: ticket.description,
    expirationDate,
    id: ticket.id,
    name: ticket.name,
    plu: ticket.plu,
    price: ticket.price,
    status: ticket.status,
    usesRemaining,
  };
};
