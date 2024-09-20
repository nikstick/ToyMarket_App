import { open } from "node:fs/promises";

import { Cache } from "node-ts-cache";
import { MemoryStorage } from "node-ts-cache-storage-memory";
import { Eta } from "eta";

import { IgnorableCacheContainer } from "common/dist/utils.js";
import { ENTITIES, ENTITIES_RAW, FIELDS, FIELDS_RAW } from "common/dist/structures.js";

export const cacheStorage = new IgnorableCacheContainer(new MemoryStorage());

export class StaticUtils {
  static eta = new Eta({views: "./static/templates", autoEscape: false, autoTrim: false})
  static GLOBALS = {
    FIELDS: FIELDS,
    FIELDS_RAW: FIELDS_RAW,
    ENTITIES: ENTITIES,
    ENTITIES_RAW: ENTITIES_RAW
  } as const;

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
    return await this.eta.renderAsync(
      name,
      Object.assign(structuredClone(data), this.GLOBALS)
    );
  }
}
