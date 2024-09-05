import { CacheContainer, ICachingOptions } from "node-ts-cache";

import { CacheKeySpec, FIELD_ALIAS } from "./structures";

export function mapObj<T, R>(
  obj: {[key: string]: T},
  func: (k: string, v: T) => [string, R]
): {[key: string]: R} {
  return Object.fromEntries(
    Object.entries(obj).map(
      ([k, v], i) => func(k, v)
    )
  );
}

export class AssertionError extends Error {}

export function assert(expr: true, error?: string): void;
export function assert(expr: false, error?: string): never;
export function assert(expr: boolean, error?: string): void;
export function assert(expr: boolean, error?: string): void {
  if (!expr) {
    throw new AssertionError(error);
  }
}

export function aliasedAs(field: string, alias?: string): string {
  if (typeof alias === "undefined") {
    alias = FIELD_ALIAS[field];
  }
  return `'${field}' AS '${alias}'`
}

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
