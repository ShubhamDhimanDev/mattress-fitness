import {describe, expect, it} from 'vitest';
import type {AnalyticsEvent} from '~/lib/analytics';
import type {ProviderAdapter} from '~/lib/analytics/adapter';
import {createConsentStore} from '~/lib/analytics/consent-store';
import {evaluatePage, type PageDecision} from '~/lib/analytics/page-context';
import {createAnalyticsRuntime} from '~/lib/analytics/runtime';

// P7-01 review 2026-10-24, M-1 and L-4: the safe-page guard in the runtime. A private or personal-looking page
// sends no event at all (Meta PageView included), loads no script, and pauses a loaded Google tag; the next safe
// page resumes it and hands the adapters the reduced address, title and referrer.

const PAGE: AnalyticsEvent = {
  name: 'page_view',
  params: {page_location: 'https://shop.example/'},
};
const ADD: AnalyticsEvent = {name: 'add_to_cart', params: {}};

function fakeAdapter(
  id: 'ga4' | 'meta',
  load?: () => Promise<{status: 'ready'}>,
) {
  const sent: string[] = [];
  const log: string[] = [];
  const adapter: ProviderAdapter = {
    id,
    category: id === 'ga4' ? 'analytics' : 'marketing',
    load: () => {
      log.push('load');
      return load ? load() : Promise.resolve({status: 'ready'});
    },
    send: (event) => {
      sent.push(event.name);
    },
    grant: () => void log.push('grant'),
    revoke: () => void log.push('revoke'),
    pause: () => void log.push('pause'),
    resume: () => void log.push('resume'),
    setPage: (context) => void log.push(`page:${context.pageTitle}`),
  };
  return {adapter, sent, log};
}

function setup(adapters: ProviderAdapter[]) {
  let location = 'https://shop.example/';
  let title = 'Home | Shop';
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
      return () => {
        const index = idle.indexOf(callback);
        if (index >= 0) idle.splice(index, 1);
      };
    },
    page: (): PageDecision =>
      evaluatePage({href: location, referrer: '', title}),
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
    idle,
    go(path: string, nextTitle = 'Some page | Shop') {
      location = `https://shop.example${path}`;
      title = nextTitle;
    },
  };
}

describe('a private page sends nothing', () => {
  it.each([
    '/account/orders/1234567890',
    '/track-order',
    '/delivery',
    '/checkout-steps',
    '/search?q=jane%40example.com',
    '/products/x?contact=5551234567',
  ])('%s: no event reaches GA4 or Meta, PageView included', async (path) => {
    const ga = fakeAdapter('ga4');
    const meta = fakeAdapter('meta');
    const {consent, runtime, idleTick, go} = setup([ga.adapter, meta.adapter]);
    consent.acceptAll();
    await idleTick();
    go('/cart');
    runtime.track(PAGE);
    expect(ga.sent).toEqual(['page_view']);
    expect(meta.sent).toEqual(['page_view']);

    go(path);
    runtime.track(PAGE);
    runtime.track(ADD);
    expect(ga.sent).toEqual(['page_view']);
    expect(meta.sent).toEqual(['page_view']);
  });

  it('a Google tag that is already loaded is paused there, and resumed on the next safe page', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idleTick, go} = setup([ga.adapter]);
    consent.acceptAll();
    await idleTick();
    go('/account/orders/1');
    runtime.track(PAGE);
    expect(ga.log.at(-1)).toBe('pause');
    runtime.track(ADD);
    expect(ga.sent).toEqual([]);
    go('/products/cloud');
    runtime.track(PAGE);
    expect(ga.log.at(-2)).toBe('resume');
    expect(ga.sent).toEqual(['page_view']);
    // Paused once, not on every event.
    expect(ga.log.filter((entry) => entry === 'pause')).toHaveLength(1);
  });

  it('no script is loaded while the shopper is on a private page, even after consent is given there', async () => {
    const ga = fakeAdapter('ga4');
    const meta = fakeAdapter('meta');
    const {consent, runtime, idleTick, idle, go} = setup([
      ga.adapter,
      meta.adapter,
    ]);
    go('/account/orders/1');
    runtime.track(PAGE);
    consent.acceptAll(); // the banner is shown on every page, so this can happen here
    expect(idle).toHaveLength(0);
    await idleTick();
    expect(ga.log).toEqual([]);
    expect(meta.log).toEqual([]);
    expect(runtime.states()).toEqual({ga4: 'idle', meta: 'idle'});
  });

  it('the first safe page after that starts the load and reports itself once', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idleTick, idle, go} = setup([ga.adapter]);
    go('/track-order');
    runtime.track(PAGE);
    consent.acceptAll();
    go('/products/cloud');
    runtime.track(PAGE);
    expect(idle).toHaveLength(1);
    await idleTick();
    expect(ga.log.filter((entry) => entry === 'load')).toHaveLength(1);
    expect(ga.sent).toEqual(['page_view']);
  });

  it('a page seen before consent is not reported if the shopper agrees after moving to a private page', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idleTick, go} = setup([ga.adapter]);
    runtime.track(PAGE); // a safe page, before consent
    go('/account');
    runtime.track(PAGE); // now a private page: the memory of the earlier page is dropped
    consent.acceptAll();
    await idleTick();
    expect(ga.log).toEqual([]);
    expect(ga.sent).toEqual([]);
  });

  it('events queued on a safe page are dropped, not flushed, if the shopper reached a private page while the script loaded', async () => {
    let finish: () => void = () => {};
    const ga = fakeAdapter(
      'ga4',
      () =>
        new Promise((resolve) => {
          finish = () => resolve({status: 'ready'});
        }),
    );
    const {consent, runtime, idleTick, go} = setup([ga.adapter]);
    consent.acceptAll();
    await idleTick();
    runtime.track(PAGE);
    runtime.track(ADD);
    go('/account/orders/1');
    finish();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(ga.sent).toEqual([]);
    expect(ga.log.at(-1)).toBe('pause');
  });

  it('a page check that throws counts as unsafe', async () => {
    const ga = fakeAdapter('ga4');
    const consent = createConsentStore({
      mode: 'opt-out',
      storage: {read: () => null, write: () => {}},
    });
    const runtime = createAnalyticsRuntime({
      adapters: [ga.adapter],
      consent,
      schedule: () => () => {},
      page: () => {
        throw new Error('no window');
      },
    });
    runtime.start();
    expect(() => runtime.track(PAGE)).not.toThrow();
    expect(ga.sent).toEqual([]);
    expect(ga.log).toEqual([]);
  });
});

describe('a safe page hands the adapters the reduced address, title and referrer', () => {
  it('setPage runs before the page_view is sent, with the fixed title on search', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idleTick, go} = setup([ga.adapter]);
    consent.acceptAll();
    await idleTick();
    go('/search?q=firm+queen', 'Search: firm queen | Shop');
    runtime.track(PAGE);
    expect(ga.log.at(-1)).toBe('page:Search');
    expect(ga.sent).toEqual(['page_view']);
  });

  it('is given to a provider that is still to load, so its first events carry it', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, go} = setup([ga.adapter]);
    go('/products/cloud', 'Cloud Mattress | Shop');
    runtime.track(PAGE);
    consent.acceptAll();
    expect(ga.log).toContain('page:Cloud Mattress | Shop');
  });
});
