/**
 * Internal promise-with-external-settlement helper.
 *
 * Not exported from the package barrel: it exists so the scheduler and the RPC
 * client can hand out a promise now and settle it later, without pulling in a
 * dependency. `Promise.withResolvers` would do the same job but is not in the
 * repo's `lib` target (ES2023).
 */

/** A promise plus its settle functions. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

/** Create a {@link Deferred}. */
export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Swallow-nothing no-op used to mark a promise as observed. */
export function noop(): void {
  /* intentionally empty */
}
