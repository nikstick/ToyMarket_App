import { open } from "fs/promises";

import { Cache, CacheContainer, ICachingOptions } from "node-ts-cache";
import { MemoryStorage } from "node-ts-cache-storage-memory";
import { Eta } from "eta";

import { CacheKeySpec } from "./structures";

export class IgnorableCacheContainer extends CacheContainer {
  public static EMPTY = "_*_";

  public async setItem(
    key: string,
    content: any,
    options: Partial<ICachingOptions>
  ): Promise<void> {
    if (key == IgnorableCacheContainer.EMPTY || content == null) { return; }
    await super.setItem(key, content, options);
  }

  public static jsonCalcKey(data: CacheKeySpec): string {
    return `${data.className}:${<string>data.methodName}:${JSON.stringify(data.args)}`;
  }

  public static excludedCalcKey(
    excluder: (data: CacheKeySpec) => boolean
  ): (data: CacheKeySpec) => string {
    return (data) => {
      if (excluder(data)) { return this.EMPTY; }
      return this.jsonCalcKey(data);
    }
  }
}

export const cacheStorage = new IgnorableCacheContainer(new MemoryStorage());

export class StaticUtils {
  static eta = new Eta({views: "./static/templates", autoEscape: false, autoTrim: false})

  @Cache(cacheStorage, {isCachedForever: true})
  public static async getText(name: string): Promise<string> {
    const file = await open(`./static/text/${name}.txt`);
    let text = await file.readFile({encoding: "utf-8"});
    await file.close();
    return text;
  }

  @Cache(cacheStorage, {
    ttl: 60,
    isLazy: false,
    calculateKey: IgnorableCacheContainer.excludedCalcKey((data) => !data.args[2])
  })
  public static async renderText(
    name: string,
    data: {[key: string]: any},
    cached: boolean = false
  ): Promise<string> {
    return await this.eta.renderAsync(name, data);
  }
}
