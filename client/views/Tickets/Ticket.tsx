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

export const Ticket = ({ ticket, onClick }: Props): ReactElement => {
  let name: string;
  let status: ReactNode;

  if (ticket.type === "ticket") {
    const isValid = ticket.status === "Valid";
    const expirationDate = DateTime.fromMillis(ticket.expirationDate);
    const today = DateTime.local()
      .set({
        hour: 3,
        minute: 0,
        second: 0,
        millisecond: 0,
      })
      .plus({ day: 1 });
    const isExpired = expirationDate < today;
    name = ticket.nickname || ticket.description;
    status = (
      <div className="flex items-center text-sm mt-2 justify-between">
        {!isValid && (
          <span
            className={clsx("px-2 py-1 text-white font-bold mr-2 rounded", {
              "bg-red-dark": !isValid,
            })}
          >
            Invalid
          </span>
        )}
        {(isValid || isExpired) && (
          <span
            className={clsx("mr-2", {
              "text-red-light dark:text-red-dark font-bold": isExpired,
            })}
          >
            {isExpired
              ? "Expired!"
              : `Expires ${toShortDateString(expirationDate)}`}
          </span>
        )}
        {(isValid || (!isExpired && ticket.usesRemaining === 0)) && (
          <span
            className={clsx({
              "text-red-light dark:text-red-dark font-bold":
                ticket.usesRemaining === 0,
            })}
          >
            {pluralize(ticket.usesRemaining, "use")} left
          </span>
        )}
      </div>
    );
  } else {
    name = ticket.nickname || "Reservation Account";
    status = (
      <span className="italic text-sm mt-2">Same for all reservations</span>
    );
  }

  return (
    <li
      className={clsx(
        "flex items-center my-4",
        "p-4 rounded cursor-pointer",
        "bg-darken-high dark:bg-lighten-high",
        "text-white dark:text-gray-900"
      )}
      key={ticket.id}
      onClick={() => onClick()}
    >
      <div className={clsx("flex flex-col flex-grow")}>
        <span className="text-xl">{name}</span>
        {status}
      </div>
    </li>
  );
};
