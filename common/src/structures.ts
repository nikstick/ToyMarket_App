import { mapObj } from "./utils";

export const ENTITIES_RAW = {
  users: 1,
  products: 26,
  clients: 29,
  news: 30,
}
export const FIELDS_RAW = {
  users: {
    tgID: 299,
  },
  clients: {
    tgID: 281,
    status: 273,
  },
  news: {
    text: 295,
    img: 296,
    url: 297,
    publishDate: 301,  // FIXME: MISSING!
  },
  products: {
    photo: 220
  }
}
export const VALUES = {
  clients: {
    status: {
      active: 68,
    },
  },
  orders: {
    payment_method: {
      in_cash: 1,
      account: 2,
      card: 3
    },
    delivery_method: {
      courier: 4,
      self_pickup: 5
    }
  }
}

export const ENTITIES = mapObj(
  ENTITIES_RAW,
  (k, v) => [k, `app_entity_${v}`]
);
export const FIELDS = mapObj(
  FIELDS_RAW,
  (k, v) => [
    k,
    mapObj(v, (k1, v1: number) => [k1, `field_${v1}`])
  ]
);

export interface SprutonItem {
  id: number
}
