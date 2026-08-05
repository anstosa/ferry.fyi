import type {
  ReservationAccount,
  TicketStorage,
} from "shared/contracts/tickets";
import { parseSavedTicketCode } from "shared/lib/tickets";

interface TicketRemovalOptions {
  closeOverlay: () => Promise<void>;
  deleted: TicketStorage | ReservationAccount;
  removeLocal: () => void;
  savedTickets: string[] | undefined;
  updateUser: (data: { app_metadata: { tickets: string[] } }) => Promise<void>;
}

// commit ticket removal transaction
export const commitTicketRemoval = async ({
  closeOverlay,
  deleted,
  removeLocal,
  savedTickets,
  updateUser,
}: TicketRemovalOptions): Promise<void> => {
  const nextSavedTickets = savedTickets?.filter(
    // remove matching saved code
    (savedCode) => parseSavedTicketCode(savedCode).code !== deleted.id
  );

  // account cleanup guard
  if (nextSavedTickets) {
    await updateUser({
      app_metadata: { tickets: nextSavedTickets },
    });
  }

  removeLocal();
  await closeOverlay();
};
