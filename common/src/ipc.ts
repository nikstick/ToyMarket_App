import type { RowDataPacket } from "mysql2";

export interface NewOrder {
  orderID: number;
  client: {
    tgID: number;
    fullName: string;
    phoneNumber: string;
    address: string;
    comment: string;
    companyName: string;
    inn: string;
  }
  src: {
    delivery: string;
    payBy: string;
  }
  items: [
    RowDataPacket,
    {quantity: number}
  ][]
}
