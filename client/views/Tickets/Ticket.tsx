import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement, ReactNode } from "react";
import type {
  ReservationAccount,
  TicketStorage,
} from "shared/contracts/tickets";
import { pluralize } from "shared/lib/strings";

import { toShortDateString } from "~/lib/date";

interface Props {
  ticket: TicketStorage | ReservationAccount;
  onClick: () => void;
}

type ProductLabel =
  | "Reservation Account"
  | "Multi-Ride Ticket"
  | "Single Ride Ticket";

// stub line pairs
const PRODUCT_LABEL_LINES: Record<ProductLabel, [string, string]> = {
  "Reservation Account": ["RESERVATION", "ACCOUNT"],
  "Multi-Ride Ticket": ["MULTI-RIDE", "TICKET"],
  "Single Ride Ticket": ["SINGLE RIDE", "TICKET"],
};

// card product titles
const PRODUCT_TITLES: Record<ProductLabel, string> = {
  "Reservation Account": "WSF reservation account",
  "Multi-Ride Ticket": "WSF Multi-ride pass",
  "Single Ride Ticket": "WSF single-ride pass",
};

// multi-ride detector
const isMultiRideTicket = (ticket: TicketStorage): boolean => {
  const passText = `${ticket.description} ${ticket.name} ${ticket.plu}`;

  // QR fallback pass
  if (ticket.codeFormat === "qr" && !ticket.description && !ticket.name) {
    return true;
  }

  // remaining rides guard
  if (typeof ticket.usesRemaining === "number" && ticket.usesRemaining > 1) {
    return true;
  }

  return /multi|pass|commuter|monthly|10[- ]?ride|ten[- ]?ride/i.test(passText);
};

// product stub label
const getProductLabel = (
  ticket: TicketStorage | ReservationAccount
): ProductLabel => {
  // account label
  if (ticket.type === "reservation") {
    return "Reservation Account";
  }

  // multi-ride label
  if (isMultiRideTicket(ticket)) {
    return "Multi-Ride Ticket";
  }

  return "Single Ride Ticket";
};

export const Ticket = ({ ticket, onClick }: Props): ReactElement => {
  let badge: ReactNode = null;
  let name: string;
  let status: ReactNode;
  let subtitle: string;
  const typeLabel = getProductLabel(ticket);
  const typeLabelLines = PRODUCT_LABEL_LINES[typeLabel];
  const productTitle = PRODUCT_TITLES[typeLabel];
  // account tab variant
  const isReservationAccount = ticket.type === "reservation";
  const codeLabel = ticket.codeFormat === "qr" ? "QR code" : "barcode";
  const isCodeSubtitle =
    ticket.type === "reservation" || ticket.codeFormat === "qr";

  // ticket display
  if (ticket.type === "ticket") {
    const { expirationDate: expirationDateMillis, usesRemaining } = ticket;
    const hasExpirationDate = typeof expirationDateMillis === "number";
    const hasUsesRemaining = typeof usesRemaining === "number";
    const isValid = ticket.status === "Valid";
    name = productTitle;
    subtitle =
      ticket.codeFormat === "qr"
        ? ticket.id
        : ticket.name || ticket.plu || ticket.id;
    // incomplete ticket guard
    if (!hasExpirationDate || !hasUsesRemaining) {
      status = (
        <span className="text-sm font-semibold text-gray-dark dark:text-white/65">
          Refreshing ticket details
        </span>
      );
    } else {
      const expirationDate = DateTime.fromMillis(expirationDateMillis);
      const today = DateTime.local()
        .set({
          hour: 3,
          minute: 0,
          second: 0,
          millisecond: 0,
        })
        .plus({ day: 1 });
      const isExpired = expirationDate < today;
      const isEmpty = usesRemaining === 0;
      badge = (
        <span
          className={clsx(
            "rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.14em]",
            {
              "bg-green-lightest text-green-dark dark:bg-green-light/20 dark:text-green-light":
                isValid && !isExpired && !isEmpty,
              "bg-red-light text-red-dark dark:bg-red-dark/25 dark:text-red-light":
                !isValid || isExpired || isEmpty,
            }
          )}
        >
          {isValid && !isExpired && !isEmpty ? "Ready" : "Check"}
        </span>
      );
      status = (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-bold">
          {!isValid && (
            <span className="rounded-full bg-red-light px-3 py-1 text-red-dark dark:bg-red-dark/25 dark:text-red-light">
              Invalid
            </span>
          )}
          {(isValid || isExpired) && (
            <span
              className={clsx("rounded-full px-3 py-1", {
                "bg-darken-lowest text-gray-dark dark:bg-white/10 dark:text-white/70":
                  !isExpired,
                "bg-red-light text-red-dark dark:bg-red-dark/25 dark:text-red-light":
                  isExpired,
              })}
            >
              {isExpired
                ? "Expired"
                : `Expires ${toShortDateString(expirationDate)}`}
            </span>
          )}
          {(isValid || (!isExpired && isEmpty)) && (
            <span
              className={clsx("rounded-full px-3 py-1", {
                "bg-darken-lowest text-gray-dark dark:bg-white/10 dark:text-white/70":
                  !isEmpty,
                "bg-red-light text-red-dark dark:bg-red-dark/25 dark:text-red-light":
                  isEmpty,
              })}
            >
              {pluralize(usesRemaining, "use")} left
            </span>
          )}
        </div>
      );
    }
  } else {
    name = productTitle;
    status = (
      <span className="text-sm font-semibold text-gray-dark dark:text-white/65">
        Same {codeLabel} for all reservations
      </span>
    );
    subtitle = ticket.id;
  }

  return (
    <li>
      <button
        className={clsx(
          "group relative w-full overflow-hidden rounded-2xl border p-0 text-left shadow-sm",
          "border-[rgba(0,0,0,0.08)] bg-white text-gray-darkest hover:-translate-y-0.5 hover:shadow-lg",
          "dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a] dark:text-white"
        )}
        onClick={() => onClick()}
        type="button"
      >
        <span className="pointer-events-none absolute -left-4 top-1/2 z-20 h-8 w-8 -translate-y-1/2 rounded-full bg-gray-100 dark:bg-blue-darkest" />
        <span className="pointer-events-none absolute -right-4 top-1/2 z-20 h-8 w-8 -translate-y-1/2 rounded-full bg-gray-100 dark:bg-blue-darkest" />
        <span className="pointer-events-none absolute inset-y-0 left-[4.75rem] z-20 border-l-2 border-dotted border-white/80 dark:border-white/30" />
        <span className="flex min-h-28 items-stretch">
          <span
            className={clsx(
              "relative flex w-20 shrink-0 items-center justify-center px-3 py-4 text-white",
              {
                "bg-[linear-gradient(180deg,#00835f_0%,#006f52_55%,#005a4a_100%)]":
                  !isReservationAccount,
                "bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0)_34%),linear-gradient(180deg,#00364a_0%,#00798b_100%)]":
                  isReservationAccount,
              }
            )}
          >
            <span className="absolute inset-0 flex items-center justify-center px-2 py-3">
              <span className="grid -rotate-90 place-items-center gap-1 text-center text-[9px] font-black uppercase leading-none tracking-[0.12em] opacity-85">
                {/* stub lines */}
                {typeLabelLines.map((line) => (
                  <span key={line} className="block whitespace-nowrap">
                    {line}
                  </span>
                ))}
              </span>
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col justify-between p-4">
            <span className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <span className="min-w-0">
                <span className="block break-words text-xl font-black leading-tight tracking-tight text-green-dark dark:text-green-light">
                  {name}
                </span>
                <span
                  className={clsx(
                    "mt-1 block truncate text-sm font-semibold text-gray-dark dark:text-white/60",
                    {
                      "font-mono tracking-wide": isCodeSubtitle,
                    }
                  )}
                >
                  {subtitle}
                </span>
              </span>
              {badge ? (
                <span className="shrink-0 self-start">{badge}</span>
              ) : null}
            </span>
            {status}
          </span>
        </span>
      </button>
    </li>
  );
};
