export interface Ticket {
  description: string;
  expirationDate?: number;
  id: string;
  name: string;
  plu: string;
  price: string;
  status: string;
  usesRemaining: number;
  /** Epoch seconds when this ticket was acquired from Wave2Go. */
  sourceUpdatedAt?: number | null;
}

export type TicketCodeFormat = "barcode" | "qr";

export interface TicketStorage extends Partial<Ticket> {
  type: "ticket";
  id: string;
  /** saved timestamp in epoch milliseconds */
  addedAt?: number;
  nickname?: string;
  codeFormat?: TicketCodeFormat;
  sourceUpdatedAt?: number | null;
}
export interface ReservationAccount {
  type: "reservation";
  nickname?: string;
  id: string;
  codeFormat?: TicketCodeFormat;
}

export const TICKET_LOOKUP_USER_AGENT_PROFILES = [
  {
    id: "identified-contact",
    label: "Ferry FYI with contact",
    userAgent: "FerryFYI/1.0 (+https://ferry.fyi; dev@ferry.fyi)",
  },
  {
    id: "identified-product",
    label: "Ferry FYI with product URL",
    userAgent: "FerryFYI/1.0 (+https://ferry.fyi)",
  },
  {
    id: "identified-minimal",
    label: "Ferry FYI minimal",
    userAgent: "FerryFYI/1.0",
  },
] as const;

export type TicketLookupUserAgentProfileId =
  (typeof TICKET_LOOKUP_USER_AGENT_PROFILES)[number]["id"];

export interface TicketLookupAdminSettings {
  cacheTtlSeconds: number;
  selectedUserAgentProfile: TicketLookupUserAgentProfileId;
  userAgentProfiles: readonly {
    id: TicketLookupUserAgentProfileId;
    label: string;
    userAgent: string;
  }[];
}
