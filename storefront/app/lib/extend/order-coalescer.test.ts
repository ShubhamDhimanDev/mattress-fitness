import {describe, expect, it} from 'vitest';
import {createOrderCoalescer} from '~/lib/extend/order-coalescer';

// REQ-EXT-003 / T-03 / T-13 / security review L-1: replays with fresh webhook ids cannot multiply work for one order.

function harness(
  options: {cooldownMs?: number; maxRunsPerChain?: number} = {},
) {
  const clock = {t: 1_000_000};
  const sleeps: number[] = [];
  const coalescer = createOrderCoalescer<string>({
    now: () => clock.t,
    sleep: (ms) => {
      sleeps.push(ms);
      clock.t += ms;
      return Promise.resolve();
    },
    cooldownMs: options.cooldownMs ?? 10_000,
    ...(options.maxRunsPerChain === undefined
      ? {}
      : {maxRunsPerChain: options.maxRunsPerChain}),
  });
  return {clock, sleeps, coalescer};
}

/** A run the test finishes by hand, so events can arrive "while it is running". */
function manualRun() {
  let finish: (value: string) => void = () => {};
  let runs = 0;
  const run = () => {
    runs += 1;
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  };
  return {
    run,
    runs: () => runs,
    finish: (value = 'ok') => finish(value),
  };
}

describe('order coalescer', () => {
  it('runs the first event at once and reports the outcome', async () => {
    const {coalescer} = harness();
    const submitted = coalescer.submit('1', () => Promise.resolve('done'));
    expect(submitted.status).toBe('started');
    if (submitted.status === 'started') {
      expect(await submitted.done).toBe('done');
    }
  });

  it('merges events that arrive while a run is in flight into one trailing run', async () => {
    const {coalescer, sleeps} = harness();
    const run = manualRun();
    const first = coalescer.submit('1', run.run);
    if (first.status !== 'started') throw new Error('expected a started run');
    for (let i = 0; i < 20; i += 1) {
      expect(coalescer.submit('1', run.run).status).toBe('merged');
    }
    expect(run.runs()).toBe(1);

    run.finish('first');
    await new Promise((resolve) => setImmediate(resolve));
    // The trailing run waits for the cooldown, then reads the order again once.
    expect(run.runs()).toBe(2);
    expect(sleeps).toEqual([10_000]);
    run.finish('second');
    expect(await first.done).toBe('second');
    expect(run.runs()).toBe(2);
  });

  it('spaces repeated events for the same order by the cooldown', async () => {
    const {coalescer, clock, sleeps} = harness();
    const a = coalescer.submit('1', () => Promise.resolve('a'));
    if (a.status === 'started') await a.done;
    clock.t += 3000;
    const b = coalescer.submit('1', () => Promise.resolve('b'));
    if (b.status === 'started') expect(await b.done).toBe('b');
    expect(sleeps).toEqual([7000]);
  });

  it('does not delay a different order, nor the same order after the cooldown', async () => {
    const {coalescer, clock, sleeps} = harness();
    const a = coalescer.submit('1', () => Promise.resolve('a'));
    if (a.status === 'started') await a.done;
    const other = coalescer.submit('2', () => Promise.resolve('x'));
    if (other.status === 'started') await other.done;
    clock.t += 10_000;
    const again = coalescer.submit('1', () => Promise.resolve('c'));
    if (again.status === 'started') await again.done;
    expect(sleeps).toEqual([]);
  });

  it('merges an event that arrives while the run is waiting out its cooldown (that run will read fresh data)', async () => {
    const {coalescer, clock} = harness();
    const a = coalescer.submit('1', () => Promise.resolve('a'));
    if (a.status === 'started') await a.done;
    clock.t += 1000;
    let runs = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const second = coalescer.submit('1', async () => {
      runs += 1;
      await gate;
      return 'b';
    });
    // Same tick: the second is waiting for its cooldown; a third event must not start another run.
    expect(coalescer.submit('1', () => Promise.resolve('c')).status).toBe(
      'merged',
    );
    release();
    if (second.status === 'started') await second.done;
    expect(runs).toBe(1);
  });

  it('survives a run that throws, and reports it as crashed', async () => {
    const {coalescer} = harness();
    const submitted = coalescer.submit('1', () =>
      Promise.reject(new Error('boom')),
    );
    if (submitted.status !== 'started') throw new Error('expected started');
    expect(await submitted.done).toBe('crashed');
    const next = coalescer.submit('1', () => Promise.resolve('again'));
    if (next.status === 'started') expect(await next.done).toBe('again');
  });

  it('caps the runs one chain can make, so a flood cannot keep one background task alive for ever', async () => {
    const {coalescer} = harness({maxRunsPerChain: 2});
    const run = manualRun();
    const first = coalescer.submit('1', run.run);
    if (first.status !== 'started') throw new Error('expected started');
    coalescer.submit('1', run.run);
    run.finish('1');
    await new Promise((resolve) => setImmediate(resolve));
    coalescer.submit('1', run.run);
    run.finish('2');
    await first.done;
    expect(run.runs()).toBe(2);
  });

  it('forgets idle orders beyond its memory bound', async () => {
    const clock = {t: 0};
    const sleeps: number[] = [];
    const coalescer = createOrderCoalescer<string>({
      now: () => clock.t,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      maxEntries: 3,
      cooldownMs: 10_000,
    });
    for (let id = 1; id <= 10; id += 1) {
      const submitted = coalescer.submit(String(id), () =>
        Promise.resolve('x'),
      );
      if (submitted.status === 'started') await submitted.done;
    }
    // Order 1 was forgotten, so it is not delayed; order 10 is still remembered and is.
    const forgotten = coalescer.submit('1', () => Promise.resolve('y'));
    if (forgotten.status === 'started') await forgotten.done;
    expect(sleeps).toEqual([]);
    const remembered = coalescer.submit('10', () => Promise.resolve('z'));
    if (remembered.status === 'started') await remembered.done;
    expect(sleeps).toEqual([10_000]);
  });
});
