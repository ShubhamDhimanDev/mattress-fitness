import {describe, expect, it} from 'vitest';
import type {AnalyticsEvent} from '~/lib/analytics';
import type {ProviderAdapter} from '~/lib/analytics/adapter';
import {createConsentStore} from '~/lib/analytics/consent-store';
import {evaluatePage} from '~/lib/analytics/page-context';
import {createAnalyticsRuntime} from '~/lib/analytics/runtime';

// P7-01 review 2026-10-24 (M-1): the page's own view events, like its page view, are remembered in memory until the
// shopper agrees and then sent once; they are never sent before, and not for another page. Events that arrive while
// the chunk is still loading (replayed by `setTrackSink`) are queued, not dropped.

const PAGE: AnalyticsEvent = {name: 'page_view', params: {}};
const VIEW_ITEM: AnalyticsEvent = {name: 'view_item', params: {}};
const SEARCH: AnalyticsEvent = {name: 'search', params: {search_term: 'queen'}};
const LIST: AnalyticsEvent = {name: 'view_item_list', params: {}};
const CART: AnalyticsEvent = {name: 'view_cart', params: {}};
const ADD: AnalyticsEvent = {name: 'add_to_cart', params: {}};

function fakeAdapter(id: 'ga4' | 'meta') {
  const sent: string[] = [];
  const adapter: ProviderAdapter = {
    id,
    category: id === 'ga4' ? 'analytics' : 'marketing',
    load: () => Promise.resolve({status: 'ready'}),
    send: (event) => void sent.push(event.name),
    grant: () => {},
    revoke: () => {},
  };
  return {adapter, sent};
}

function setup(adapters: ProviderAdapter[]) {
  let location = 'https://shop.example/products/cloud';
  const consent = createConsentStore({
    mode: 'opt-in',
    storage: {read: () => null, write: () => {}},
  });
  const idle: Array<() => void> = [];
  const runtime = createAnalyticsRuntime({
    adapters,
    consent,
    schedule: (callback) => {
      idle.push(callback);
      return () => {};
    },
    page: () => evaluatePage({href: location, referrer: '', title: 'T'}),
  });
  runtime.start();
  async function idleTick() {
    for (const callback of idle.splice(0)) callback();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  }
  return {
    consent,
    runtime,
    idleTick,
    go(path: string) {
      location = `https://shop.example${path}`;
    },
  };
}

describe('view events before consent', () => {
  it('are not sent, and are sent once after the shopper agrees, after the page view', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idleTick} = setup([ga.adapter]);
    runtime.track(PAGE);
    runtime.track(VIEW_ITEM);
    runtime.track(SEARCH);
    runtime.track(LIST);
    runtime.track(CART);
    runtime.track(ADD);
    await idleTick();
    expect(ga.sent).toEqual([]);
    consent.acceptAll();
    await idleTick();
    expect(ga.sent).toEqual([
      'page_view',
      'view_item',
      'search',
      'view_item_list',
    ]);
  });

  it('view_cart and the cart actions are not remembered: they are actions, not the page', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idleTick} = setup([ga.adapter]);
    runtime.track(CART);
    runtime.track(ADD);
    consent.acceptAll();
    await idleTick();
    expect(ga.sent).toEqual([]);
  });

  it('are not replayed for a different page', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idleTick, go} = setup([ga.adapter]);
    runtime.track(VIEW_ITEM);
    go('/collections/all');
    runtime.track(PAGE);
    consent.acceptAll();
    await idleTick();
    expect(ga.sent).toEqual(['page_view']);
  });

  it('are not replayed after a stay on a private page in between', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idleTick, go} = setup([ga.adapter]);
    runtime.track(VIEW_ITEM);
    go('/account');
    runtime.track(PAGE);
    go('/products/cloud');
    consent.acceptAll();
    await idleTick();
    expect(ga.sent).toEqual([]);
  });

  it('a provider that agrees later gets them while the earlier one is not sent them twice', async () => {
    const ga = fakeAdapter('ga4');
    const meta = fakeAdapter('meta');
    const {consent, runtime, idleTick} = setup([ga.adapter, meta.adapter]);
    runtime.track(PAGE);
    runtime.track(VIEW_ITEM);
    consent.save({analytics: true, marketing: false});
    await idleTick();
    expect(ga.sent).toEqual(['page_view', 'view_item']);
    consent.save({analytics: true, marketing: true});
    await idleTick();
    expect(ga.sent).toEqual(['page_view', 'view_item']);
    expect(meta.sent).toEqual(['page_view', 'view_item']);
  });

  it('are remembered only a few at a time', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idleTick} = setup([ga.adapter]);
    for (let i = 0; i < 30; i += 1) {
      runtime.track({name: 'view_item_list', params: {n: i}});
    }
    consent.acceptAll();
    await idleTick();
    expect(ga.sent).toHaveLength(10);
  });

  it('are not counted twice when the same page republishes them (a revisit, review m-3)', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idleTick} = setup([ga.adapter]);
    runtime.track(VIEW_ITEM);
    runtime.track(VIEW_ITEM);
    runtime.track(SEARCH);
    runtime.track(SEARCH);
    consent.acceptAll();
    await idleTick();
    expect(ga.sent).toEqual(['view_item', 'search']);
  });
});

describe('events replayed while the runtime had just started (M-1)', () => {
  it('with consent already stored, an event tracked right after start is queued and sent once, not dropped', async () => {
    const ga = fakeAdapter('ga4');
    const consent = createConsentStore({
      mode: 'opt-in',
      storage: {
        read: () =>
          JSON.stringify({
            version: 1,
            analytics: true,
            marketing: false,
            decidedAt: Math.floor(Date.now() / 1000),
          }),
        write: () => {},
      },
    });
    const idle: Array<() => void> = [];
    const runtime = createAnalyticsRuntime({
      adapters: [ga.adapter],
      consent,
      schedule: (callback) => {
        idle.push(callback);
        return () => {};
      },
    });
    runtime.start();
    runtime.track(LIST);
    runtime.track(VIEW_ITEM);
    for (const callback of idle.splice(0)) callback();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(ga.sent).toEqual(['view_item_list', 'view_item']);
  });

  it('a cart action tracked BEFORE start is lost (only the view events of the page are remembered): the order in ConsentRuntime matters', async () => {
    const ga = fakeAdapter('ga4');
    const consent = createConsentStore({
      mode: 'opt-in',
      storage: {
        read: () =>
          JSON.stringify({
            version: 1,
            analytics: true,
            marketing: false,
            decidedAt: Math.floor(Date.now() / 1000),
          }),
        write: () => {},
      },
    });
    const idle: Array<() => void> = [];
    const runtime = createAnalyticsRuntime({
      adapters: [ga.adapter],
      consent,
      schedule: (callback) => {
        idle.push(callback);
        return () => {};
      },
    });
    runtime.track(ADD);
    runtime.start();
    for (const callback of idle.splice(0)) callback();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(ga.sent).toEqual([]);
  });
});
