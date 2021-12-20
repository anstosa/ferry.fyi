// based on code donated by @jordansoltman, the developer for Ferry Friend on iOS

import { DateTime } from "luxon";
import { isKeyOf } from "shared/lib/objects";
import { JSDOM } from "jsdom";
import { Ticket } from "shared/contracts/tickets";
import fetch from "node-fetch";
import logger from "heroku-logger";

const WAVE2GO_LANDING =
  "https://wave2go.wsdot.com/webstore/landingPage?cg=21&c=76";
const WAVE2GO_TICKET =
  "https://wave2go.wsdot.com/webstore/account/ticketLookup.aspx?VisualID=";

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

export const fetchTicket = async (ticketId: string): Promise<Ticket | null> => {
  const cookie = await getWsfCookie();
  const response = await fetch(`${WAVE2GO_TICKET}${ticketId}`, {
    headers: { cookie },
  });

  const { window } = new JSDOM(await response.text(), {});

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
    logger.debug(key ?? "null");
    if (!key || !isKeyOf(PROPERTY_BY_DATA, key)) {
      return;
    }
    const value = span.textContent ?? "";
    const property = PROPERTY_BY_DATA[key];
    ticket[property] = value;
  });

  logger.debug(JSON.stringify(ticket));

  return {
    description: ticket.description,
    expirationDate: DateTime.fromFormat(
      ticket.expirationDate,
      "LLLL d, yyyy"
    ).toMillis(),
    id: ticket.id,
    name: ticket.name,
    plu: ticket.plu,
    price: ticket.price,
    status: ticket.status,
    usesRemaining: Number(ticket.usesRemaining),
  };
};

const getWsfCookie = async (): Promise<string> => {
  const response = await fetch(WAVE2GO_LANDING);
  const cookie = response.headers.get("set-cookie") ?? "";
  return cookie;
};
