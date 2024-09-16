import { mapObj } from "./utils.js";

export const ENTITIES_RAW = {
  users: 1,
  productCategories: 25,
  products: 26,
  orders: 27,
  orderItems: 28,
  clients: 29,
  news: 30,
  prices: 31
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
    companyName: 272,
    status: 273,
    inn: 276,
    tgID: 281,
    personalDiscount: 338,
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
    price: 318,
    keywords: 319,
    tax: 370,
    packageSize: 383,
    finalPriceServiced: 401,
  },
  productCategories: {
    name: 213
  },
  orders: {
    title: 234,
    client: 235,
    paymentMethod: 279,
    deliveryMethod: 280,
    phoneNumber: 283,
    email: 284,
    address: 285,
    companyName: 286,
    inn: 287,
    taxedAmount: 327,
    status: 337,
    personalDiscount: 341,
    amount: 368,
    comment: 396,
  },
  orderItems: {
    product: 242,
    quantity: 245,
    price: 246,
    boxesCount: 248,
    boxSize: 249,
    category: 250,
    recomendedMinimalSize: 305,
    tax: 363,
    taxedPrice: 364,
    amount: 366,
    packageSize: 385,
    article: 399,
  },
  prices: {
    price: 313,
    isCurrent: 314,
    discount: 321,
    discountedPrice: 322,
    article: 373,
    code: 374
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
    },
    status: {
      new: 41,
      paid: 42,
      delivered: 43,
      cancelled: 44,
      archived: 46
    },
  },
  global: {
    tax: {
      none: 50,
      perc10: 51,
      perc20: 52
    },
  },
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
