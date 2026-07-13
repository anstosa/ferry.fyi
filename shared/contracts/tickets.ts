export interface Ticket {
  description: string;
  expirationDate?: number;
  id: string;
  name: string;
  plu: string;
  price: string;
  status: string;
  usesRemaining: number;
}

export type TicketCodeFormat = "barcode" | "qr";

export interface TicketStorage extends Partial<Ticket> {
  type: "ticket";
  id: string;
  nickname?: string;
  codeFormat?: TicketCodeFormat;
}
export interface ReservationAccount {
  type: "reservation";
  nickname?: string;
  id: string;
  codeFormat?: TicketCodeFormat;
}
