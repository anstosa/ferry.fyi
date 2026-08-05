import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement } from "react";
import type {
  ReservationAccount,
  TicketStorage,
} from "shared/contracts/tickets";
import { pluralize } from "shared/lib/strings";
import { getTicketDisplayInfo, getTicketProductKind } from "shared/lib/tickets";

import { toAddedDateString, toShortDateString } from "~/lib/date";

interface Props {
  ticket: TicketStorage | ReservationAccount;
  onClick: () => void;
}

type ProductLabel =
  | "Reservation Account"
  | "Multi-Ride Ticket"
  | "Single Ride Ticket"
  | "Ticket";

// stub line pairs
const PRODUCT_LABEL_LINES: Record<ProductLabel, [string, string]> = {
  "Reservation Account": ["RESERVATION", "ACCOUNT"],
  "Multi-Ride Ticket": ["MULTI-RIDE", "TICKET"],
  "Single Ride Ticket": ["SINGLE RIDE", "TICKET"],
  Ticket: ["WSF", "TICKET"],
};

// card product titles
const PRODUCT_TITLES: Record<ProductLabel, string> = {
  "Reservation Account": "WSF Reservation Account",
  "Multi-Ride Ticket": "WSF Multi-Ride Pass",
  "Single Ride Ticket": "WSF Single-Ride Pass",
  Ticket: "WSF Ticket",
};

// product stub label
const getProductLabel = (
  ticket: TicketStorage | ReservationAccount
): ProductLabel => {
  // account label
  if (ticket.type === "reservation") {
    return "Reservation Account";
  }

  const productKind = getTicketProductKind(ticket);
  if (productKind === "multi-ride") {
    return "Multi-Ride Ticket";
  }
  if (productKind === "single-ride") {
    return "Single Ride Ticket";
  }
  return "Ticket";
};

export const Ticket = ({ ticket, onClick }: Props): ReactElement => {
  let name: string;
  let routeName: string | undefined;
  // unresolved ticket placeholder
  let status: ReactElement = (
    <span className="text-sm font-semibold text-gray-dark dark:text-white/65">
      Ticket details unavailable
    </span>
  );
  let subtitle: string;
  const typeLabel = getProductLabel(ticket);
  const typeLabelLines = PRODUCT_LABEL_LINES[typeLabel];
  const productTitle = PRODUCT_TITLES[typeLabel];
  // account tab variant
  const isReservationAccount = ticket.type === "reservation";
  // multi-ride theme variant
  const isMultiRideProduct = typeLabel === "Multi-Ride Ticket";
  const codeLabel = ticket.codeFormat === "qr" ? "QR code" : "barcode";
  const isCodeSubtitle =
    ticket.type === "reservation" || ticket.codeFormat === "qr";
  const addedLabel =
    ticket.type === "ticket" && typeof ticket.addedAt === "number"
      ? `Added ${toAddedDateString(DateTime.fromMillis(ticket.addedAt))}`
      : null;

  // ticket display
  if (ticket.type === "ticket") {
    const { expirationDate: expirationDateMillis, usesRemaining } = ticket;
    const {
      routeName: ticketRouteName,
      subtitle: ticketSubtitle,
      title: ticketTitle,
    } = getTicketDisplayInfo({
      description: ticket.description,
      fallbackTitle: productTitle,
      name: ticket.name,
      plu: ticket.plu || ticket.id,
    });
    const hasExpirationDate = typeof expirationDateMillis === "number";
    const hasUsesRemaining = typeof usesRemaining === "number";
    routeName = ticketRouteName;
    name = ticketTitle;
    subtitle =
      ticket.codeFormat === "qr"
        ? ticket.id
        : ticketSubtitle || ticket.plu || ticket.id;
    // resolved ticket details
    if (hasUsesRemaining) {
      const expirationDate = hasExpirationDate
        ? DateTime.fromMillis(expirationDateMillis)
        : null;
      const today = DateTime.local()
        .set({
          hour: 3,
          minute: 0,
          second: 0,
          millisecond: 0,
        })
        .plus({ day: 1 });
      const isExpired = expirationDate !== null && expirationDate < today;
      const isEmpty = usesRemaining === 0;
      const isSingleRide = typeLabel === "Single Ride Ticket";
      let usageLabel = `${pluralize(usesRemaining, "ride")} left`;
      // single ride label
      if (isSingleRide) {
        usageLabel = isEmpty ? "Used" : "Unused";
      }
      status = (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-bold">
          {expirationDate ? (
            <span
              className={clsx("rounded-full px-3 py-1", {
                "bg-darken-lowest text-gray-dark dark:bg-white/10 dark:text-white/70":
                  !isExpired,
                "bg-red-light text-red-dark dark:bg-red-dark/25 dark:text-red-light":
                  isExpired,
              })}
            >
              {isExpired ? "Expired" : "Expires"}{" "}
              {toShortDateString(expirationDate)}
            </span>
          ) : null}
          <span
            className={clsx("rounded-full px-3 py-1", {
              "bg-darken-lowest text-gray-dark dark:bg-white/10 dark:text-white/70":
                !isSingleRide && !isEmpty,
              "bg-green-lightest text-green-dark dark:bg-green-light/20 dark:text-green-light":
                isSingleRide && !isEmpty,
              "bg-red-light text-red-dark dark:bg-red-dark/25 dark:text-red-light":
                isEmpty,
            })}
          >
            {usageLabel}
          </span>
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
          "text-gray-darkest hover:-translate-y-0.5 hover:shadow-lg dark:text-white",
          {
            // standard card theme
            "border-[rgba(0,0,0,0.08)] bg-white dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]":
              !isMultiRideProduct,
            // multi-ride card theme
            "border-transparent bg-white dark:border-transparent dark:bg-[#211800]":
              isMultiRideProduct,
          }
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
              "relative flex w-20 shrink-0 items-center justify-center px-3 py-4",
              {
                // single-ride stub theme
                "bg-[radial-gradient(circle_at_34%_16%,rgba(255,255,255,0.46)_0%,rgba(255,255,255,0.18)_24%,rgba(255,255,255,0)_42%),linear-gradient(180deg,#00835f_0%,#006f52_58%,#005a4a_100%)] text-white":
                  !isReservationAccount && !isMultiRideProduct,
                // multi-ride stub theme
                "bg-[radial-gradient(circle_at_78%_14%,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0.22)_24%,rgba(255,255,255,0)_42%),linear-gradient(180deg,#f2b705_0%,#c98a00_58%,#7a5400_100%)] text-white":
                  isMultiRideProduct,
                // reservation stub theme
                "bg-[radial-gradient(circle_at_66%_15%,rgba(255,255,255,0.34)_0%,rgba(255,255,255,0.12)_24%,rgba(255,255,255,0)_42%),linear-gradient(180deg,#00364a_0%,#00798b_100%)] text-white":
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
          <span
            className={clsx("flex min-w-0 flex-1 flex-col p-4", {
              // standard spacing
              "justify-between": !isReservationAccount,
              // reservation spacing
              "justify-center gap-2": isReservationAccount,
              // multi-ride text panel
              "bg-white dark:bg-white": isMultiRideProduct,
            })}
          >
            <span className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <span className="min-w-0">
                {/* route chip */}
                {ticket.type === "ticket" && routeName ? (
                  <span
                    className={clsx(
                      "mb-2 inline-flex max-w-full rounded-full px-2.5 py-1 text-2xs font-black uppercase tracking-[0.14em]",
                      {
                        // multi-ride route chip
                        "bg-yellow-medium/20 text-yellow-dark dark:bg-yellow-medium/15 dark:text-yellow-lightest":
                          isMultiRideProduct,
                        // default route chip
                        "bg-blue-dark/10 text-blue-dark dark:bg-[#6fb8c8]/15 dark:text-[#6fb8c8]":
                          !isMultiRideProduct,
                      }
                    )}
                  >
                    <span className="truncate">{routeName}</span>
                  </span>
                ) : null}
                <span
                  className={clsx(
                    "block break-words text-xl font-black leading-tight tracking-tight",
                    {
                      // multi-ride title theme
                      "text-yellow-dark dark:text-yellow-dark":
                        isMultiRideProduct,
                      // reservation title theme
                      "text-blue-dark dark:text-[#6fb8c8]":
                        isReservationAccount,
                      // default title theme
                      "text-green-dark dark:text-green-light":
                        !isMultiRideProduct && !isReservationAccount,
                    }
                  )}
                >
                  {name}
                </span>
                <span
                  className={clsx(
                    "block truncate text-sm font-semibold text-gray-dark",
                    {
                      // reservation subtitle spacing
                      "mt-2": isReservationAccount,
                      // standard subtitle spacing
                      "mt-1": !isReservationAccount,
                      "font-mono tracking-wide": isCodeSubtitle,
                    }
                  )}
                >
                  {subtitle}
                </span>
              </span>
            </span>
            {status}
            {addedLabel ? (
              <span className="mt-2 block text-xs font-bold text-gray-dark/75 dark:text-white/55">
                {addedLabel}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
};
