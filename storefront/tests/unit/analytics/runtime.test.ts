import {describe, expect, it, vi} from 'vitest';
import type {AnalyticsEvent} from '~/lib/analytics';
import type {
  ProviderAdapter,
  ProviderLoadResult,
} from '~/lib/analytics/adapter';
import {createConsentStore} from '~/lib/analytics/consent-store';
import {
  createAnalyticsRuntime,
  MAX_QUEUED_EVENTS,
} from '~/lib/analytics/runtime';

// P7-01: consent gating, idle loading, replay, withdrawal and failure isolation. NFR-011, NFR-013, REQ-ANL-001/002.

const PAGE: AnalyticsEvent = {
  name: 'page_view',
  params: {page_location: 'https://x.example/'},
};
const ADD: AnalyticsEvent = {name: 'add_to_cart', params: {}};

function fakeAdapter(
  id: 'ga4' | 'meta',
  load: () => Promise<ProviderLoadResult> = () =>
    Promise.resolve({status: 'ready'}),
) {
  const sent: AnalyticsEvent[] = [];
  const log: string[] = [];
  const adapter: ProviderAdapter = {
    id,
    category: id === 'ga4' ? 'analytics' : 'marketing',
    load: () => {
      log.push('load');
      return load();
    },
    send: (event) => {
      sent.push(event);
    },
    grant: () => {
      log.push('grant');
    },
    revoke: () => {
      log.push('revoke');
    },
  };
  return {adapter, sent, log};
}

function setup(options: {
  mode?: 'opt-in' | 'opt-out';
  adapters: ProviderAdapter[];
  stored?: string | null;
}) {
  let value = options.stored ?? null;
  const consent = createConsentStore({
    mode: options.mode ?? 'opt-in',
    storage: {read: () => value, write: (next) => void (value = next)},
  });
  const idle: Array<() => void> = [];
  const failures: string[] = [];
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
    onFailure: (provider, reason) => failures.push(`${provider}:${reason}`),
  });
  runtime.start();
  /** Runs what was scheduled for idle time, then lets the load promises settle. */
  async function idleTick() {
    const due = idle.splice(0);
    for (const callback of due) callback();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
  return {consent, runtime, idle, idleTick, failures};
}

describe('nothing before consent (NFR-011)', () => {
  it('opt-in: no script is requested, nothing is scheduled, nothing is sent, however many events arrive', async () => {
    const ga = fakeAdapter('ga4');
    const meta = fakeAdapter('meta');
    const {runtime, idle, idleTick} = setup({
      adapters: [ga.adapter, meta.adapter],
    });
    runtime.track(PAGE);
    runtime.track(ADD);
    await idleTick();
    expect(idle).toHaveLength(0);
    expect(ga.log).toEqual([]);
    expect(meta.log).toEqual([]);
    expect(ga.sent).toEqual([]);
    expect(meta.sent).toEqual([]);
    expect(runtime.states()).toEqual({ga4: 'idle', meta: 'idle'});
  });

  it('rejecting all keeps it that way', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idle} = setup({adapters: [ga.adapter]});
    consent.rejectAll();
    runtime.track(PAGE);
    expect(idle).toHaveLength(0);
    expect(ga.log).toEqual([]);
  });
});

describe('after consent: on idle, never blocking, current page replayed (REQ-ANL-001)', () => {
  it('schedules the load for idle time instead of loading synchronously', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, idle} = setup({adapters: [ga.adapter]});
    consent.acceptAll();
    expect(ga.log).toEqual([]);
    expect(idle).toHaveLength(1);
  });

  it('sends the page view recorded before consent once the provider is ready, then later events directly', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idleTick} = setup({adapters: [ga.adapter]});
    runtime.track(PAGE); // before consent: held in memory only
    runtime.track(ADD); // before consent: dropped
    consent.acceptAll();
    expect(ga.sent).toEqual([]);
    await idleTick();
    expect(ga.sent).toEqual([PAGE]);
    runtime.track(ADD);
    expect(ga.sent).toEqual([PAGE, ADD]);
  });

  it('events that arrive while the script is loading are queued and replayed in order', async () => {
    let finish: (result: ProviderLoadResult) => void = () => {};
    const ga = fakeAdapter(
      'ga4',
      () => new Promise((resolve) => (finish = resolve)),
    );
    const {consent, runtime, idleTick} = setup({adapters: [ga.adapter]});
    consent.acceptAll();
    await idleTick();
    runtime.track(PAGE);
    runtime.track(ADD);
    expect(ga.sent).toEqual([]);
    finish({status: 'ready'});
    await Promise.resolve();
    await Promise.resolve();
    expect(ga.sent).toEqual([PAGE, ADD]);
  });

  it('the queue is bounded', async () => {
    let finish: (result: ProviderLoadResult) => void = () => {};
    const ga = fakeAdapter(
      'ga4',
      () => new Promise((resolve) => (finish = resolve)),
    );
    const {consent, runtime, idleTick} = setup({adapters: [ga.adapter]});
    consent.acceptAll();
    await idleTick();
    for (let i = 0; i < MAX_QUEUED_EVENTS + 20; i += 1) runtime.track(ADD);
    finish({status: 'ready'});
    await Promise.resolve();
    await Promise.resolve();
    expect(ga.sent).toHaveLength(MAX_QUEUED_EVENTS);
  });
});

describe('categories are separate (analytics and marketing)', () => {
  it('analytics only: GA4 loads, Meta does not', async () => {
    const ga = fakeAdapter('ga4');
    const meta = fakeAdapter('meta');
    const {consent, runtime, idleTick} = setup({
      adapters: [ga.adapter, meta.adapter],
    });
    consent.save({analytics: true, marketing: false});
    await idleTick();
    runtime.track(ADD);
    expect(ga.sent).toEqual([ADD]);
    expect(meta.log).toEqual([]);
    expect(meta.sent).toEqual([]);
  });

  it('marketing agreed later gives Meta the current page view and loads only then', async () => {
    const ga = fakeAdapter('ga4');
    const meta = fakeAdapter('meta');
    const {consent, runtime, idleTick} = setup({
      adapters: [ga.adapter, meta.adapter],
    });
    consent.save({analytics: true, marketing: false});
    await idleTick();
    runtime.track(PAGE);
    consent.save({analytics: true, marketing: true});
    await idleTick();
    expect(meta.sent).toEqual([PAGE]);
    expect(ga.sent).toEqual([PAGE]);
  });
});

describe('opt-out mode (configuration switch, not a legal decision)', () => {
  it('allows analytics at once with no decision, and respects a later rejection', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idleTick} = setup({
      mode: 'opt-out',
      adapters: [ga.adapter],
    });
    await idleTick();
    runtime.track(ADD);
    expect(ga.sent).toEqual([ADD]);
    consent.rejectAll();
    expect(ga.log).toContain('revoke');
    runtime.track(ADD);
    expect(ga.sent).toEqual([ADD]);
  });
});

describe('withdrawal and re-grant', () => {
  it('revokes the loaded provider, stops sending, and does not load the script twice on re-grant', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idleTick} = setup({adapters: [ga.adapter]});
    consent.acceptAll();
    await idleTick();
    consent.rejectAll();
    expect(ga.log).toEqual(['load', 'revoke']);
    runtime.track(ADD);
    expect(ga.sent).toEqual([]);
    consent.acceptAll();
    await idleTick();
    expect(ga.log).toEqual(['load', 'revoke', 'grant']);
    runtime.track(ADD);
    expect(ga.sent).toEqual([ADD]);
  });

  it('withdrawal before the idle callback cancels the load', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, idle, idleTick} = setup({adapters: [ga.adapter]});
    consent.acceptAll();
    expect(idle).toHaveLength(1);
    consent.rejectAll();
    expect(idle).toHaveLength(0);
    await idleTick();
    expect(ga.log).toEqual([]);
  });

  it('withdrawal while the script is loading revokes as soon as it finishes and sends nothing queued', async () => {
    let finish: (result: ProviderLoadResult) => void = () => {};
    const ga = fakeAdapter(
      'ga4',
      () => new Promise((resolve) => (finish = resolve)),
    );
    const {consent, runtime, idleTick} = setup({adapters: [ga.adapter]});
    consent.acceptAll();
    await idleTick();
    runtime.track(ADD);
    consent.rejectAll();
    finish({status: 'ready'});
    await Promise.resolve();
    await Promise.resolve();
    expect(ga.sent).toEqual([]);
    expect(ga.log).toEqual(['load', 'revoke']);
  });
});

describe('a failing provider never breaks the page (NFR-013)', () => {
  it.each(['error', 'timeout', 'unavailable', 'origin-refused'] as const)(
    'a %s load marks it failed, reports once, and later events are dropped',
    async (reason) => {
      const ga = fakeAdapter('ga4', () =>
        Promise.resolve({status: 'failed', reason}),
      );
      const meta = fakeAdapter('meta');
      const {consent, runtime, idleTick, failures} = setup({
        adapters: [ga.adapter, meta.adapter],
      });
      consent.acceptAll();
      await idleTick();
      expect(failures).toEqual([`ga4:${reason}`]);
      expect(() => runtime.track(ADD)).not.toThrow();
      expect(ga.sent).toEqual([]);
      expect(meta.sent).toEqual([ADD]); // the other provider carries on
      expect(runtime.states().ga4).toBe('failed');
    },
  );

  it('a load that rejects, and a send or revoke that throws, are all contained', async () => {
    const bad = fakeAdapter('ga4', () => Promise.reject(new Error('network')));
    const {consent, runtime, idleTick, failures} = setup({
      adapters: [bad.adapter],
    });
    consent.acceptAll();
    await idleTick();
    expect(failures).toEqual(['ga4:error']);

    const throwing: ProviderAdapter = {
      ...fakeAdapter('meta').adapter,
      send: () => {
        throw new Error('send');
      },
      revoke: () => {
        throw new Error('revoke');
      },
    };
    const second = setup({adapters: [throwing]});
    second.consent.acceptAll();
    await second.idleTick();
    expect(() => second.runtime.track(ADD)).not.toThrow();
    expect(() => second.consent.rejectAll()).not.toThrow();
    expect(runtime).toBeDefined();
  });

  it('a failure callback that throws does not escape', async () => {
    const ga = fakeAdapter('ga4', () =>
      Promise.resolve({status: 'failed', reason: 'error'}),
    );
    const consent = createConsentStore({
      mode: 'opt-in',
      storage: {read: () => null, write: () => {}},
    });
    const idle: Array<() => void> = [];
    const runtime = createAnalyticsRuntime({
      adapters: [ga.adapter],
      consent,
      schedule: (callback) => {
        idle.push(callback);
        return () => {};
      },
      onFailure: () => {
        throw new Error('logger down');
      },
    });
    runtime.start();
    consent.acceptAll();
    expect(() => idle.forEach((callback) => callback())).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('after stop() nothing is sent and nothing loads', async () => {
    const ga = fakeAdapter('ga4');
    const {consent, runtime, idleTick} = setup({adapters: [ga.adapter]});
    consent.acceptAll();
    runtime.stop();
    await idleTick();
    runtime.track(ADD);
    expect(ga.log).toEqual([]);
    expect(ga.sent).toEqual([]);
  });

  it('with no adapters (no ids set) everything is a no-op', () => {
    const {runtime, consent} = setup({adapters: []});
    consent.acceptAll();
    const spy = vi.fn();
    expect(() => runtime.track(ADD)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    expect(runtime.states()).toEqual({});
  });
});
