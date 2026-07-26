import type { AdminConfirmationAction } from "shared/contracts/admin";

/** Mirrors the server's canonical typed-confirmation format. */
export const confirmationPhrase = (
  action: AdminConfirmationAction,
  target: string
): string => `CONFIRM ${action} ${target}`;
