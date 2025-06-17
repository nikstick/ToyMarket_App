import { mapObj } from "./utils.js";

export const ENTITIES_RAW = {
  users: 1,
  productType: 25,
  products: 26,
  orders: 27,
  orderItems: 28,
  clients: 29,
  news: 30,
  productCategory: 35,
  productSubCategory: 36,
  tradeMarks: 37,
  shoeSizes: 38,
  retailOutlets: 40,
  country: 47,
} as const;
export const FIELDS_RAW = {
  users: {
    tgID: 299,
  },
  clients: {
    fullName: 265,
    email: 267,
    address: 269,
    password: 271,
    companyName: 272,
    status: 273,
    inn: 276,
    tgID: 281,
    tgNick: 303,
    personalDiscount: 338,
    tgPhoneNumber: 404,
  },
  news: {
    text: 295,
    img: 296,
    publishDate: 301,  // FIXME: MISSING!
  },
  products: {
    photo: 220,
    article: 221,
    boxSize: 222,
    inStock: 223,
    prepayPercent: 224,
    productType: 225,
    preorderConditions: 226,
    accessabilitySettings: 227,
    description: 274,
    review: 275,
    isNew: 277,
    isSiteViewable: 278,
    otherPhotos: 288,
    recomendedMinimalSize: 306,
    recomendedMinimalSizeBoxParts: 315,
    remained: 316,
    keywords: 319,
    marketplaceAcessability: 353,
    storeDeliveryInDays: 354,
    prepayAmount: 355,
    tax: 370,
    packageSize: 383,
    name: 387,
    color: 388,
    finalPriceServiced: 401,
    modelID: 423,
    tradeMark: 425,
    category: 432,
    textColor: 433,
    shoeSize: 434,
    discountedPrice: 435,
    price: 437,
    sizeUnit: 438,
    producingCountry: 439,
    minKidAge: 442,
    maxKidAge: 443,
    kidGender: 444,
    subCategory: 456,
    rutubeReview: 461,
    WBURL: 595,
    OzonURL: 597,
    AvitoURL: 599,
    YaMarketURL: 601,
    modelName: 889,
    material: 890,
    recomendedMinimalSizeEnabled: 992,
  },
  productType: {
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
    fullName: 286,
    trackNumber: 287,
    status: 337,
    discountPercent: 341,
    taxedDiscountedCashAmount: 361,
    taxedDiscountedRemoteAmount: 368,
    comment: 369,
    pickupPoint: 608,
    transportCompany: 609,
    code: 895,
  },
  orderItems: {
    product: 242,
    quantity: 245,
    discountedPrice: 246,
    recomendedMinimalSize: 305,
    tax: 363,
    _taxedPrice: 364,
    amount: 366,
    packageSize: 385,
    article: 399,
    price: 638,
  },
  productCategory: {
    name: 421,
  },
  productSubCategory: {
    name: 422,
  },
  tradeMarks: {
    name: 436,
    about: 458,
    logo: 459,
  },
  shoeSizes: {
    length: 451,
    ruSize: 452,
    euSize: 453,
    cls: 454,
    name: 455,
  },
  countries: {
    shortName: 727,
    code: 728,
    flag: 729,
    fullName: 730,
    alfa2: 731,
    alfa3: 732,
    isViewable: 733,
    enName: 734,
  },
  retailOutlets: {
    name: 491,
    address: 493,
    openingTime: 658,
    closingTime: 659,
    deliveryTime: 940,
    pickupPointStatus: 941,
  },
} as const;
export const VALUES = {
  clients: {
    status: {
      active: 68,
    },
  },
  products: {
    color: {
      red: 76,
      gray: 77,
      blue: 78,
      black: 79,
      green: 80,
      violet: 81,
      multicolor: 82,
      yellow: 84,
    },
    accessabilitySettings: {
      checkIfInStock: 222,
      preorder: 223,
      alwaysInStock: 224
    },
    marketplaceAcessability: {
      wb: 225,
      ozon: 226,
      avito: 227,
      yaMarket: 28
    }
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
  shoeSizes: {
    cls: {
      forKids: 72,
      beforeSchool: 73,
    },
  },
  global: {
    tax: {
      none: 50,
      perc10: 51,
      perc20: 52
    },
    kidAge: {
      0: 56,
      1: 57,
      2: 58,
      3: 59,
      4: 60,
      5: 61,
      6: 62,
      7: 63,
      8: 64,
      9: 65,
      10: 66,
      11: 67,
      12: 68,
    },
    kidGender: {
      male: 69,
      female: 70,
      unisex: 71
    }
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
