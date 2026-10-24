import {describe, expect, it} from 'vitest';
import type {AnalyticsEvent} from '~/lib/analytics';
import type {ProviderAdapter} from '~/lib/analytics/adapter';
import {createConsentStore} from '~/lib/analytics/consent-store';
import {evaluatePage} from '~/lib/analytics/page-context';
import {createAnalyticsRuntime} from '~/lib/analytics/runtime';

// Re-review 2026-10-24: A-L3 (cookies removed in every state), m-4 (a provider paused on a private page is not left
// paused after withdraw and re-grant), A-M1 (pause on the pending navigation target, before the address changes).

const PAGE: AnalyticsEvent = {name: 'page_view', params: {}};
const ADD: AnalyticsEvent = {name: 'add_to_cart', params: {}};

function fakeAdapter(id: 'ga4' | 'meta' = 'ga4') {
  const log: string[] = [];
  const adapter: ProviderAdapter = {
    id,
    category: id === 'ga4' ? 'analytics' : 'marketing',
    load: () => {
      log.push('load');
      return Promise.resolve({status: 'ready'});
    },
    send: (event) => void log.push(`send:${event.name}`),
    grant: () => void log.push('grant'),
    revoke: () => void log.push('revoke'),
    pause: () => void log.push('pause'),
    resume: () => void log.push('resume'),
    clearStored: () => void log.push('clear'),
  };
  return {adapter, log};
}

function setup(options: {
  adapters: ProviderAdapter[];
  stored?: string | null;
  path?: string;
}) {
  let path = options.path ?? '/products/cloud';
  const consent = createConsentStore({
    mode: 'opt-in',
    storage: {read: () => options.stored ?? null, write: () => {}},
  });
  const idle: Array<() => void> = [];
  const runtime = createAnalyticsRuntime({
    adapters: options.adapters,
    consent,
    schedule: (callback) => {
      idle.push(callback);
      return () => {
        const index = idle.indexOf(callback);
        if (index >= 0) idle.splice(index, 1);
      };
    },
    page: () =>
      evaluatePage({
        href: `https://shop.example${path}`,
        referrer: '',
        title: 'T',
      }),
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
    go(next: string) {
      path = next;
    },
  };
}

describe('cookies are removed in every state (A-L3)', () => {
  it('at the first look without consent, once, for every provider', () => {
    const ga = fakeAdapter('ga4');
    const meta = fakeAdapter('meta');
    const {consent} = setup({adapters: [ga.adapter, meta.adapter]});
    expect(ga.log).toEqual(['clear']);
    expect(meta.log).toEqual(['clear']);
    consent.rejectAll();
    expect(ga.log).toEqual(['clear']);
  });

  it('when an expired decision is read as no decision', () => {
    const ga = fakeAdapter();
    const expired = JSON.stringify({
      version: 1,
      analytics: true,
      marketing: true,
      decidedAt: Math.floor(Date.now() / 1000) - 400 * 24 * 3600,
    });
    setup({adapters: [ga.adapter], stored: expired});
    expect(ga.log).toEqual(['clear']);
  });

  it('not for a provider that has consent', () => {
    const ga = fakeAdapter();
    const stored = JSON.stringify({
      version: 1,
      analytics: true,
      marketing: false,
      decidedAt: Math.floor(Date.now() / 1000),
    });
    setup({adapters: [ga.adapter], stored});
    expect(ga.log).not.toContain('clear');
  });

  it('on withdrawal before the script has loaded (scheduled)', () => {
    const ga = fakeAdapter();
    const {consent} = setup({adapters: [ga.adapter]});
    consent.acceptAll();
    consent.rejectAll();
    expect(ga.log).toEqual(['clear', 'clear']);
    expect(ga.log).not.toContain('load');
  });

  it('on withdrawal while the script is loading', async () => {
    const ga = fakeAdapter();
    let finish: () => void = () => {};
    const adapter: ProviderAdapter = {
      ...ga.adapter,
      load: () =>
        new Promise((resolve) => {
          finish = () => resolve({status: 'ready'});
        }),
    };
    const {consent, idleTick} = setup({adapters: [adapter]});
    consent.acceptAll();
    await idleTick();
    consent.rejectAll();
    expect(ga.log.filter((entry) => entry === 'clear')).toHaveLength(2);
    finish();
    await Promise.resolve();
  });

  it('on withdrawal of a loaded provider: revoke, then clear', async () => {
    const ga = fakeAdapter();
    const {consent, idleTick} = setup({adapters: [ga.adapter]});
    consent.acceptAll();
    await idleTick();
    ga.log.length = 0;
    consent.rejectAll();
    expect(ga.log).toEqual(['revoke', 'clear']);
  });

  it('a clearing that throws does not escape', () => {
    const adapter: ProviderAdapter = {
      ...fakeAdapter().adapter,
      clearStored: () => {
        throw new Error('cookies blocked');
      },
    };
    expect(() => setup({adapters: [adapter]})).not.toThrow();
  });
});

describe('withdraw on a private page, re-grant on a safe one (m-4)', () => {
  it('resumes the paused provider on withdrawal, so the next grant starts clean', async () => {
    const ga = fakeAdapter();
    const {consent, runtime, idleTick, go} = setup({adapters: [ga.adapter]});
    consent.acceptAll();
    await idleTick();
    go('/account/orders/1');
    runtime.track(PAGE);
    expect(ga.log.at(-1)).toBe('pause');
    consent.rejectAll();
    expect(ga.log.slice(-3)).toEqual(['resume', 'revoke', 'clear']);
    go('/products/cloud');
    consent.acceptAll();
    expect(ga.log.at(-1)).toBe('grant');
    runtime.track(PAGE);
    expect(ga.log.at(-1)).toBe('send:page_view');
    expect(ga.log.filter((entry) => entry === 'pause')).toHaveLength(1);
  });
});

describe('a pending navigation to a private page pauses before the address changes (A-M1)', () => {
  it.each([
    '/account/orders/gid%3A%2F%2Fshopify%2FOrder%2F1',
    '/track-order',
    '/delivery?zip=1',
    'https://shop.example/account',
    '/%61ccount',
  ])('%s', async (target) => {
    const ga = fakeAdapter();
    const {consent, runtime, idleTick} = setup({adapters: [ga.adapter]});
    consent.acceptAll();
    await idleTick();
    ga.log.length = 0;
    runtime.setNavigationTarget(target);
    expect(ga.log).toEqual(['pause']);
    // Events during the pending navigation are not sent.
    runtime.track(ADD);
    expect(ga.log).toEqual(['pause']);
  });

  it('a safe target changes nothing; ending the navigation resumes if the page is safe', async () => {
    const ga = fakeAdapter();
    const {consent, runtime, idleTick} = setup({adapters: [ga.adapter]});
    consent.acceptAll();
    await idleTick();
    ga.log.length = 0;
    runtime.setNavigationTarget('/collections/all');
    expect(ga.log).toEqual([]);
    runtime.setNavigationTarget('/account');
    runtime.setNavigationTarget(null);
    expect(ga.log).toEqual(['pause', 'resume']);
  });

  it('after arriving on the private page it stays paused; after arriving on a safe one it is resumed', async () => {
    const ga = fakeAdapter();
    const {consent, runtime, idleTick, go} = setup({adapters: [ga.adapter]});
    consent.acceptAll();
    await idleTick();
    runtime.setNavigationTarget('/account/orders/1');
    go('/account/orders/1');
    runtime.setNavigationTarget(null);
    runtime.track(PAGE);
    expect(ga.log.filter((entry) => entry === 'resume')).toHaveLength(0);
    go('/products/cloud');
    runtime.track(PAGE);
    expect(ga.log.at(-1)).toBe('send:page_view');
    expect(ga.log).toContain('resume');
  });

  it('loads nothing while a private navigation is pending', async () => {
    const ga = fakeAdapter();
    const {consent, runtime, idleTick} = setup({adapters: [ga.adapter]});
    runtime.setNavigationTarget('/track-order');
    consent.acceptAll();
    await idleTick();
    expect(ga.log).not.toContain('load');
  });

  it('is ignored after stop()', () => {
    const ga = fakeAdapter();
    const {runtime} = setup({adapters: [ga.adapter]});
    runtime.stop();
    expect(() => runtime.setNavigationTarget('/account')).not.toThrow();
  });
});
