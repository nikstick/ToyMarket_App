import { Cache } from "node-ts-cache";
import { MemoryStorage } from "node-ts-cache-storage-memory";

import { IgnorableCacheContainer } from "common/utils";

export const cacheStorage = new IgnorableCacheContainer(new MemoryStorage());

// useless patching objects for front compatability
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
      )
    }
}
