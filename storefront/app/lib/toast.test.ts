import {describe, expect, it} from 'vitest';
import {
  DEFAULT_TOAST_DURATION_MS,
  MAX_VISIBLE_TOASTS,
  MIN_TOAST_DURATION_MS,
  RESUME_FLOOR_MS,
  dismissToast,
  enqueueToast,
  liveRegionFor,
  resumeDelay,
  toToastEntry,
  toastDuration,
  type ToastEntry,
  type ToastVariant,
} from '~/lib/toast';

// P2-03 / NFR-003: the toast rules (timing, live region, bounded stack) are pure and tested on their own.
const entry = (id: string): ToastEntry => ({
  id,
  serial: 1,
  variant: 'info',
  message: id,
  duration: DEFAULT_TOAST_DURATION_MS,
});

describe('toastDuration', () => {
  type Case = [ToastVariant, number | null | undefined, number | null];
  const cases: Case[] = [
    ['info', undefined, DEFAULT_TOAST_DURATION_MS],
    ['success', undefined, DEFAULT_TOAST_DURATION_MS],
    ['warning', undefined, DEFAULT_TOAST_DURATION_MS],
    ['error', undefined, null], // errors stay until dismissed
    ['error', 9000, 9000],
    ['info', null, null],
    ['info', 10_000, 10_000],
    ['info', 500, MIN_TOAST_DURATION_MS], // never shorter than the minimum
    ['info', 0, MIN_TOAST_DURATION_MS],
    ['info', -50, MIN_TOAST_DURATION_MS],
    ['info', Number.NaN, DEFAULT_TOAST_DURATION_MS],
    ['error', Number.NaN, null],
  ];
  it.each(cases)('%s with %s -> %s', (variant, requested, expected) => {
    expect(toastDuration(variant, requested)).toBe(expected);
  });
});

describe('liveRegionFor', () => {
  it('interrupts only for errors', () => {
    expect(liveRegionFor('error')).toBe('alert');
    expect(liveRegionFor('info')).toBe('status');
    expect(liveRegionFor('success')).toBe('status');
    expect(liveRegionFor('warning')).toBe('status');
  });
});

describe('resumeDelay', () => {
  it('gives a resumed toast at least the floor, and keeps more time when there is more', () => {
    expect(resumeDelay(100)).toBe(RESUME_FLOOR_MS);
    expect(resumeDelay(-20)).toBe(RESUME_FLOOR_MS);
    expect(resumeDelay(Number.NaN)).toBe(RESUME_FLOOR_MS);
    expect(resumeDelay(5000)).toBe(5000);
  });
});

describe('toToastEntry', () => {
  it('defaults to an info toast with the fallback id and resolved duration', () => {
    expect(toToastEntry({message: 'Saved'}, 1)).toEqual({
      id: 'toast-1',
      serial: 1,
      variant: 'info',
      title: undefined,
      message: 'Saved',
      duration: DEFAULT_TOAST_DURATION_MS,
    });
  });

  it('keeps a caller id, variant and title', () => {
    expect(
      toToastEntry(
        {id: 'cart', variant: 'error', title: 'Cart', message: 'No stock'},
        2,
      ),
    ).toMatchObject({id: 'cart', serial: 2, variant: 'error', duration: null});
  });
});

describe('enqueueToast and dismissToast', () => {
  it('adds the newest last', () => {
    const list = enqueueToast([entry('a')], entry('b'));
    expect(list.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('replaces a toast with the same id instead of stacking a duplicate', () => {
    const replaced = {...entry('a'), message: 'newer'};
    const list = enqueueToast([entry('a'), entry('b')], replaced);
    expect(list.map((item) => item.id)).toEqual(['b', 'a']);
    expect(list[1]?.message).toBe('newer');
  });

  it('drops the oldest when the stack is over its cap', () => {
    let list: ToastEntry[] = [];
    for (let n = 1; n <= MAX_VISIBLE_TOASTS + 2; n += 1) {
      list = enqueueToast(list, entry(`t${n}`));
    }
    expect(list).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(list[0]?.id).toBe('t3');
    expect(list[list.length - 1]?.id).toBe(`t${MAX_VISIBLE_TOASTS + 2}`);
  });

  it('does not change the input list', () => {
    const original = [entry('a')];
    enqueueToast(original, entry('b'));
    dismissToast(original, 'a');
    expect(original.map((item) => item.id)).toEqual(['a']);
  });

  it('dismisses by id and ignores an unknown id', () => {
    const list = [entry('a'), entry('b')];
    expect(dismissToast(list, 'a').map((item) => item.id)).toEqual(['b']);
    expect(dismissToast(list, 'zzz')).toHaveLength(2);
  });
});
