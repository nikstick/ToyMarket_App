import { Cache } from "node-ts-cache";
import { MemoryStorage } from "node-ts-cache-storage-memory";

import { IgnorableCacheContainer } from "common/dist/utils.js";

export const cacheStorage = new IgnorableCacheContainer(new MemoryStorage());

// TODO: move to views
export namespace usefulFront {
  export function order(obj, orderItems) {
    let orderTotalPrice = orderItems.reduce(
      (sum, item) => sum + Number(item.amount),
      0
    );
    Object.assign(
      obj,
      {
        orderDate: obj.date_added,
        products: orderItems,
        total: orderTotalPrice,
      }
    );
    delete obj.date_added;
  }
}

// useless patching of objects for front compatability
export namespace uselessFront {
  export function product(obj): void {
    Object.assign(
      obj,
      {
        image: obj.photo,
        inBox: obj.recomendedMinimalSize,
        inTheBox: obj.boxSize,
        inPackage: obj.packageSize,
        new: obj.isNew,
        keyWords: obj.keywords,
        otherImages: obj.otherPhotos,
      }
    );
    if (obj.categoryName == null) {
      obj.categoryName = "Без категории";
    }
  }

  export function order(obj): void {
    Object.assign(
      obj,
      {
        orderId: obj.id,
        discount: obj.discountPercent
      }
    );
  }
}
