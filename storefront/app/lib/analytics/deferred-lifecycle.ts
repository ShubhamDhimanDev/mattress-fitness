// A resource that survives an immediate release-and-acquire (P7-01; QA finding F-1).
//
// React's StrictMode (development only) runs an effect, cleans it up and runs it again at once. The consent runtime
// registers the `track()` sink, which replays the events held while its chunk loaded, so tearing it down in that cleanup
// and building a new one loses what the first one was given. Here the release only schedules the disposal for the next
// tick; an acquire with the same key before then cancels it and gets the same value back. In production, where the
// effect runs once, the disposal simply happens a tick after the component goes.

type Entry<T> = {
  readonly key: string;
  readonly value: T;
  readonly dispose: () => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

export type DeferredLifecycle<T> = {
  /** The live value for `key`, built with `create` unless a release of the same key is still pending. */
  readonly acquire: (
    key: string,
    create: () => {value: T; dispose: () => void},
  ) => T;
  /** Schedules the disposal for the next tick. */
  readonly release: () => void;
};

export function createDeferredLifecycle<T>(): DeferredLifecycle<T> {
  let entry: Entry<T> | null = null;

  function disposeNow(target: Entry<T>): void {
    if (target.timer !== undefined) clearTimeout(target.timer);
    if (entry === target) entry = null;
    try {
      target.dispose();
    } catch {
      // A teardown error must never reach the page (NFR-013).
    }
  }

  return {
    acquire(key, create) {
      if (entry && entry.timer !== undefined && entry.key === key) {
        clearTimeout(entry.timer);
        entry.timer = undefined;
        return entry.value;
      }
      if (entry) disposeNow(entry);
      const made = create();
      entry = {
        key,
        value: made.value,
        dispose: made.dispose,
        timer: undefined,
      };
      return made.value;
    },
    release() {
      const target = entry;
      if (!target || target.timer !== undefined) return;
      target.timer = setTimeout(() => disposeNow(target), 0);
    },
  };
}
