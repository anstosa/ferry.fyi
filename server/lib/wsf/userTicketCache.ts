import { Op } from "sequelize";
import type { Ticket } from "shared/contracts/tickets";

import { UserTicket } from "~/models/UserTicket";

export interface PersistedUserTicket {
  sourceUpdatedAt: number;
  ticket: Ticket;
}

export interface UserTicketCacheEntry extends PersistedUserTicket {
  fresh: boolean;
}

/** account ticket cache read */
export const readUserTicket = async (
  subject: string,
  ticketId: string,
  maximumAgeSeconds: number,
  now = Date.now()
): Promise<UserTicketCacheEntry | undefined> => {
  const stored = await UserTicket.findOne({ where: { subject, ticketId } });
  // cache miss guard
  if (!stored) {
    return undefined;
  }
  const sourceUpdatedAt = stored.sourceUpdatedAt.getTime() / 1_000;
  return {
    fresh: sourceUpdatedAt + maximumAgeSeconds > now / 1_000,
    sourceUpdatedAt,
    ticket: stored.ticketData,
  };
};

/** account ticket cache write */
export const writeUserTicket = async (
  subject: string,
  ticketId: string,
  result: PersistedUserTicket
): Promise<void> => {
  await UserTicket.upsert({
    sourceUpdatedAt: new Date(result.sourceUpdatedAt * 1_000),
    subject,
    ticketData: result.ticket,
    ticketId,
  });
};

// selected cache deletion
export const deleteUserTicket = async (
  subject: string,
  ticketId: string
): Promise<void> => {
  await UserTicket.destroy({ where: { subject, ticketId } });
};

/** unsaved account cache pruning */
export const deleteUnsavedUserTickets = async (
  subject: string,
  savedTicketIds: string[]
): Promise<void> => {
  await UserTicket.destroy({
    where: {
      subject,
      ...(savedTicketIds.length > 0
        ? { ticketId: { [Op.notIn]: savedTicketIds } }
        : {}),
    },
  });
};
