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

export function assert(expr: boolean, error?: string): void {
  if (!expr) {
    throw new AssertionError(error);
  }
}
