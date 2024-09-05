import { mapObj } from "./utils";

export const ENTITIES_RAW = {
  users: 1,
  productCategories: 25,
  products: 26,
  orders: 27,
  order_items: 28,
  clients: 29,
  news: 30,
} as const;
export const FIELDS_RAW = {
  users: {
    tgID: 299,
  },
  clients: {
    fullName: 265,
    ruPhoneNumber: 266,
    email: 267,
    address: 269,
    password: 271,
    company: 272,
    status: 273,
    inn: 276,
    tgID: 281,
  },
  news: {
    text: 295,
    img: 296,
    url: 297,
    publishDate: 301,  // FIXME: MISSING!
  },
  products: {
    photo: 220,
    article: 221,
    boxSize: 222,
    inStock: 223,
    category: 225,
    description: 274,
    review: 275,
    isNew: 277,
    otherPhotos: 288,
    recomendedMinimalSize: 306,
    recomendedMinimalSizeBoxParts: 315,
    keywords: 319,
    packageSize: 383,
    finalPriceServiced: 401,
  },
  productCategories: {
    name: 213
  },
  orders: {
    title: 234,
    client: 235,
  },
  order_items: {
    product: 242,
    quantity: 245,
    price: 246,
    taxed_price: 364
  }
} as const;
export const VALUES = {
  clients: {
    status: {
      active: 68,
    },
  },
  orders: {
    paymentMethod: {
      inCash: 1,
      account: 2,
      card: 3
    },
    deliveryMethod: {
      courier: 4,
      selfPickup: 5
    }
  }
} as const;

type EntitiesT = {[key in keyof typeof ENTITIES_RAW]: `app_entity_${typeof ENTITIES_RAW[key]}`};
export const ENTITIES: EntitiesT = mapObj(
  ENTITIES_RAW,
  (k, v) => [k, `app_entity_${v}`]
) as unknown as EntitiesT;

type FieldsT = {
  [key in keyof typeof FIELDS_RAW]: {
    [key1 in keyof typeof FIELDS_RAW[key]]: (
      typeof FIELDS_RAW[key][key1] extends number
      ? `field_${typeof FIELDS_RAW[key][key1]}`
      : never
    )
  }
};
export const FIELDS: FieldsT = mapObj(
  FIELDS_RAW,
  (k, v) => [
    k,
    mapObj(v, (k1, v1) => [k1, `field_${v1}`])
  ]
) as unknown as FieldsT;

export const FIELD_ALIAS = Object.values(FIELDS).map(
  (obj) => mapObj(
    obj,
    (k, v) => [v, k]
  )
).reduce(
  (left, right) => Object.assign(left, right),
  {}
);

export interface SprutonItem {
  id: number
}

export interface CacheKeySpec {
  className: string
  methodName: string
  args: any[]
}
