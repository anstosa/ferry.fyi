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
