import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createDeferredLifecycle} from '~/lib/analytics/deferred-lifecycle';

// QA F-1: a release followed at once by an acquire (React StrictMode in development) keeps the same value; a release
// alone disposes it a tick later; a different key never reuses it.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function factory() {
  const disposed: number[] = [];
  let made = 0;
  return {
    disposed,
    made: () => made,
    create: () => {
      made += 1;
      const id = made;
      return {value: id, dispose: () => void disposed.push(id)};
    },
  };
}

describe('createDeferredLifecycle', () => {
  it('release then acquire at once gives the same value back and disposes nothing', () => {
    const f = factory();
    const life = createDeferredLifecycle<number>();
    expect(life.acquire('a', f.create)).toBe(1);
    life.release();
    expect(life.acquire('a', f.create)).toBe(1);
    vi.runAllTimers();
    expect(f.made()).toBe(1);
    expect(f.disposed).toEqual([]);
  });

  it('a release with no acquire after it disposes on the next tick, once', () => {
    const f = factory();
    const life = createDeferredLifecycle<number>();
    life.acquire('a', f.create);
    life.release();
    life.release();
    expect(f.disposed).toEqual([]);
    vi.runAllTimers();
    expect(f.disposed).toEqual([1]);
    expect(life.acquire('a', f.create)).toBe(2);
  });

  it('a different key disposes the old value at once and builds a new one', () => {
    const f = factory();
    const life = createDeferredLifecycle<number>();
    life.acquire('a', f.create);
    life.release();
    expect(life.acquire('b', f.create)).toBe(2);
    expect(f.disposed).toEqual([1]);
    vi.runAllTimers();
    expect(f.disposed).toEqual([1]);
  });

  it('a disposal that throws does not escape', () => {
    const life = createDeferredLifecycle<number>();
    life.acquire('a', () => ({
      value: 1,
      dispose: () => {
        throw new Error('boom');
      },
    }));
    life.release();
    expect(() => vi.runAllTimers()).not.toThrow();
  });

  it('release with nothing acquired does nothing', () => {
    const life = createDeferredLifecycle<number>();
    expect(() => life.release()).not.toThrow();
  });
});
