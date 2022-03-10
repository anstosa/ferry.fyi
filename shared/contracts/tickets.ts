export interface Ticket {
  description: string;
  expirationDate: number;
  id: string;
  name: string;
  plu: string;
  price: string;
  status: string;
  usesRemaining: number;
}
export interface TicketStorage extends Ticket {
  type: "ticket";
  nickname?: string;
}
export interface ReservationAccount {
  type: "reservation";
  nickname?: string;
  id: string;
}
