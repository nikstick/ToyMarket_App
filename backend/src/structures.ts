import { VALUES } from "common/structures";

export const values_translation = {
  delivery_method: {
    "курьером": VALUES.orders.delivery_method.courier,
    "самовывоз": VALUES.orders.delivery_method.self_pickup,
  },
  payment_method: {
    "наличными": VALUES.orders.payment_method.in_cash,
    "счет": VALUES.orders.payment_method.account,
    "картой": VALUES.orders.payment_method.card,
  },
};
export const ORDER_PLACEHOLDER = "$ORDER";
