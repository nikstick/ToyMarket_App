import type { RowDataPacket } from "mysql2";

import { SprutonItem } from "./structures.js";

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
    personalDiscount: number;
  }
  src: {
    delivery: string;
    payBy: string;
  }
  items: [
    RowDataPacket,
    {quantity: number}
  ][];
  orderMeta: RowDataPacket;
  orderMetaExtra: SprutonItem;
}
