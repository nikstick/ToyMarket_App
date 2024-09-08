import { VALUES } from "common/dist/structures.js";

export const valuesTranslation = {
  deliveryMethod: {
    "курьером": VALUES.orders.deliveryMethod.courier,
    "самовывоз": VALUES.orders.deliveryMethod.selfPickup,
  },
  paymentMethod: {
    "наличными": VALUES.orders.paymentMethod.inCash,
    "счет": VALUES.orders.paymentMethod.account,
    "картой": VALUES.orders.paymentMethod.card,
  },
} as const;
export const ORDER_PLACEHOLDER = "$ORDER";
