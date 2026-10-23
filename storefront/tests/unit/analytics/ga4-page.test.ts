import {describe, expect, it} from 'vitest';
import type {AnalyticsEvent} from '~/lib/analytics';
import {globalsOf, type ScriptLoader} from '~/lib/analytics/adapter';
import {createGa4Adapter} from '~/lib/analytics/ga4';

// P7-01 review 2026-10-24, M-1 and L-4: GA4 is told the sanitised address, referrer and title, and is paused on
// pages that send nothing. UNVERIFIED against GA4 DebugView that `set` reaches the automatic events.

const okLoader: ScriptLoader = () => Promise.resolve({status: 'loaded'});
const ADD: AnalyticsEvent = {name: 'search', params: {search_term: 'queen'}};
const PAGE = {
  pageLocation: 'https://shop.example/search',
  pageReferrer: 'https://www.google.com',
  pageTitle: 'Search',
};

function entries(target: Record<string, unknown>): unknown[][] {
  const layer = target.dataLayer;
  return Array.isArray(layer)
    ? layer.map((entry: unknown) => Array.from(entry as ArrayLike<unknown>))
    : [];
}

function adapterFor(target: Record<string, unknown>, cleared: string[][] = []) {
  return createGa4Adapter({
    measurementId: 'G-ABCD1234',
    globals: globalsOf(target),
    loadScript: okLoader,
    clearCookies: (names) => cleared.push([...names]),
  });
}

describe('GA4 page context', () => {
  it('sets the sanitised address, referrer and title for every later event, again on each navigation', async () => {
    const target: Record<string, unknown> = {};
    const adapter = adapterFor(target);
    await adapter.load();
    adapter.setPage?.(PAGE);
    expect(entries(target).at(-1)).toEqual([
      'set',
      {
        page_location: 'https://shop.example/search',
        page_referrer: 'https://www.google.com',
        page_title: 'Search',
      },
    ]);
    adapter.setPage?.({...PAGE, pageTitle: 'Cloud Mattress'});
    expect(entries(target).at(-1)?.[1]).toMatchObject({
      page_title: 'Cloud Mattress',
    });
  });

  it('a page given before the script loads is applied before the config call, so the first hit has it', async () => {
    const target: Record<string, unknown> = {};
    const adapter = adapterFor(target);
    adapter.setPage?.(PAGE);
    await adapter.load();
    expect(
      entries(target)
        .map((entry) => entry[0])
        .slice(0, 3),
    ).toEqual(['js', 'set', 'config']);
  });
});

describe('GA4 pause and resume', () => {
  it("pause sets Google's disable flag (its automatic hits stop) and keeps the cookies; resume lifts it", async () => {
    const target: Record<string, unknown> = {};
    const cleared: string[][] = [];
    const adapter = adapterFor(target, cleared);
    await adapter.load();
    adapter.pause?.();
    expect(target['ga-disable-G-ABCD1234']).toBe(true);
    const size = entries(target).length;
    adapter.send(ADD);
    expect(entries(target)).toHaveLength(size);
    expect(cleared).toEqual([]);
    adapter.resume?.();
    expect(target['ga-disable-G-ABCD1234']).toBe(false);
    adapter.send(ADD);
    expect(entries(target)).toHaveLength(size + 1);
  });

  it('a withdrawn consent is not undone by resume, and a re-grant on a paused page stays paused', async () => {
    const target: Record<string, unknown> = {};
    const adapter = adapterFor(target);
    await adapter.load();
    adapter.revoke();
    adapter.resume?.();
    expect(target['ga-disable-G-ABCD1234']).toBe(true);
    adapter.pause?.();
    adapter.grant();
    expect(target['ga-disable-G-ABCD1234']).toBe(true);
    adapter.resume?.();
    expect(target['ga-disable-G-ABCD1234']).toBe(false);
  });
});
