// Per-order debounce for the webhook sync (security review L-1, T-03, T-13). Anyone holding ONE validly signed body can
// replay it with a fresh `X-Shopify-Webhook-Id` (the id is an unsigned header), so de-duplicating by webhook id cannot
// bound the work. Every accepted event costs an Admin API read and possibly an Extend call, so this module bounds
// it per ORDER instead:
//
//   - an order is synced at most once per `cooldownMs`;
//   - an event that arrives while a sync of that order is waiting or running is merged into it: the sync always reads
//     the order fresh, so one run covers every event that arrived before it started, and one trailing run covers
//     events that arrived while it was running. No event is lost, none is run in parallel.
//
// State is per isolate (a memory map), which is enough to blunt amplification; the idempotent full-snapshot PUT is what
// makes a duplicate harmless. The clock and the sleep are injected so tests never wait.

import type {NowFn, SleepFn} from '~/lib/extend/types';

export type OrderCoalescer<Outcome> = {
  /**
   * `started`: the caller owns a background run; await `done` (it never rejects) to learn how the LAST run ended.
   * `merged`: an existing run will cover this event; nothing more to do.
   */
  submit: (
    orderId: string,
    run: () => Promise<Outcome>,
  ) =>
    | {status: 'started'; done: Promise<Outcome | 'crashed'>}
    | {status: 'merged'};
};

type Phase = 'idle' | 'waiting' | 'running';

type Entry = {
  phase: Phase;
  rerun: boolean;
  lastStartedAt: number;
};

export type CoalescerOptions = {
  now: NowFn;
  sleep: SleepFn;
  /** Minimum time between two runs for the same order. */
  cooldownMs?: number;
  /** Runs chained from one `submit` (the first plus trailing reruns), so a flood cannot keep one task alive forever. */
  maxRunsPerChain?: number;
  maxEntries?: number;
};

export function createOrderCoalescer<Outcome>(
  options: CoalescerOptions,
): OrderCoalescer<Outcome> {
  const cooldownMs = options.cooldownMs ?? 10_000;
  const maxRuns = Math.max(1, options.maxRunsPerChain ?? 3);
  const maxEntries = options.maxEntries ?? 5000;
  const entries = new Map<string, Entry>();

  function remember(orderId: string, entry: Entry): void {
    // Re-insert so the Map's first key is always the least recently used.
    entries.delete(orderId);
    entries.set(orderId, entry);
    if (entries.size <= maxEntries) return;
    for (const [key, candidate] of entries) {
      if (candidate.phase === 'idle') {
        entries.delete(key);
        if (entries.size <= maxEntries) return;
      }
    }
  }

  async function chain(
    entry: Entry,
    initialWaitMs: number,
    run: () => Promise<Outcome>,
  ): Promise<Outcome | 'crashed'> {
    let outcome: Outcome | 'crashed' = 'crashed';
    let waitMs = initialWaitMs;
    for (let runNumber = 1; runNumber <= maxRuns; runNumber += 1) {
      if (waitMs > 0) {
        entry.phase = 'waiting';
        await options.sleep(waitMs);
      }
      entry.phase = 'running';
      entry.rerun = false;
      entry.lastStartedAt = options.now();
      try {
        outcome = await run();
      } catch {
        outcome = 'crashed';
      }
      if (!entry.rerun) break;
      waitMs = Math.max(0, entry.lastStartedAt + cooldownMs - options.now());
    }
    entry.phase = 'idle';
    entry.rerun = false;
    return outcome;
  }

  return {
    submit(orderId, run) {
      const existing = entries.get(orderId);
      if (existing?.phase === 'waiting') return {status: 'merged'};
      if (existing?.phase === 'running') {
        existing.rerun = true;
        return {status: 'merged'};
      }
      const entry: Entry = existing ?? {
        phase: 'idle',
        rerun: false,
        lastStartedAt: Number.NEGATIVE_INFINITY,
      };
      remember(orderId, entry);
      const waitMs = Math.max(
        0,
        entry.lastStartedAt + cooldownMs - options.now(),
      );
      return {status: 'started', done: chain(entry, waitMs, run)};
    },
  };
}
