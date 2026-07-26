/**
 * An allowlisted privileged operation which requires an explicit typed
 * confirmation.  The server owns the canonical confirmation phrase; clients
 * must never be allowed to invent an operation name.
 */
export const adminConfirmationActions = [
  "clear-cache",
  "delete-checkin",
  "delete-user-data",
  "force-sign-out",
  "hide-leaderboard-profile",
  "opt-out-user",
  "pause-notifications",
  "publish-announcement",
  "reset-leaderboard-profile",
  "resume-notifications",
  "run-operation",
  "send-broadcast-notification",
  "send-targeted-notification",
  "send-test-notification",
  "set-maintenance-banner",
  "set-feature-kill-switch",
  "save-site-settings",
  "test-safe-mutation",
  "update-crawler-policy",
] as const;

export type AdminConfirmationAction = (typeof adminConfirmationActions)[number];

/** The only client input used to prove a deliberate admin action. */
export interface AdminConfirmationPayload {
  action: AdminConfirmationAction;
  confirmation: string;
  target: string;
}

/** Minimal identity data used by the owner-only user directory. */
export interface AdminUserListItem {
  email?: string;
  subject: string;
}

export interface AdminUserList {
  items: AdminUserListItem[];
  page: number;
  pageSize: number;
  total: number;
}
