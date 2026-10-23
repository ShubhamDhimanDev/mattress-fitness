// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {AnalyticsEvent} from '~/lib/analytics';
import {
  globalsOf,
  type ProviderAdapter,
  type ScriptLoader,
} from '~/lib/analytics/adapter';
import {buildExpiredCookies, hostSuffixes} from '~/lib/analytics/cookies';
import {createGa4Adapter, ga4ScriptUrl, toGa4Call} from '~/lib/analytics/ga4';
import {
  createMetaAdapter,
  META_SCRIPT_URL,
  toMetaCall,
} from '~/lib/analytics/meta';
import {createScriptLoader} from '~/lib/analytics/script-loader';
import {buildQuizStartEvent} from '~/lib/quiz/events';

// P7-01: REQ-ANL-001 (GA4), REQ-ANL-002 (Meta), NFR-013 (a provider that fails never breaks the page), T-05.
// Nothing here has been seen in GA4 DebugView or Meta's Test Events tool (UNVERIFIED, docs/integrations/ANALYTICS.md).

const ITEM = {
  id: '123',
  name: 'Cloud Mattress',
  brand: 'Acme',
  variant: 'Queen',
  priceCents: 199999,
  quantity: 2,
};

const VIEW_ITEM: AnalyticsEvent = {
  name: 'view_item',
  params: {},
  ecommerce: {items: [{...ITEM, quantity: 1}], valueCents: 199999},
};
const ADD: AnalyticsEvent = {
  name: 'add_to_cart',
  params: {},
  ecommerce: {items: [ITEM], valueCents: 399998},
};
const CHECKOUT: AnalyticsEvent = {
  name: 'begin_checkout',
  params: {},
  ecommerce: {items: [ITEM], valueCents: 399998},
};

const okLoader: ScriptLoader = () => Promise.resolve({status: 'loaded'});

afterEach(() => {
  document.head.innerHTML = '';
});

describe('GA4 mapping (REQ-ANL-001)', () => {
  it('sends dollars, USD and GA4 item fields', () => {
    expect(toGa4Call(ADD)).toEqual({
      name: 'add_to_cart',
      params: {
        currency: 'USD',
        value: 3999.98,
        items: [
          {
            item_id: '123',
            item_name: 'Cloud Mattress',
            item_brand: 'Acme',
            item_variant: 'Queen',
            price: 1999.99,
            quantity: 2,
          },
        ],
      },
    });
  });

  it('list events carry the list and the index; begin_checkout uses a beacon', () => {
    const call = toGa4Call({
      name: 'select_item',
      params: {},
      ecommerce: {
        listId: 'queen',
        listName: 'queen',
        items: [{...ITEM, quantity: 1, index: 4}],
      },
    });
    expect(call?.params).toMatchObject({
      item_list_id: 'queen',
      item_list_name: 'queen',
      transport_type: 'beacon',
    });
    expect((call?.params.items as Record<string, unknown>[])[0]).toMatchObject({
      index: 4,
    });
    expect(toGa4Call(CHECKOUT)?.params.transport_type).toBe('beacon');
    expect(toGa4Call(ADD)?.params.transport_type).toBeUndefined();
  });

  it.each(['page_view', 'search', 'view_cart', 'view_item_list'] as const)(
    'forwards %s',
    (name) => {
      expect(toGa4Call({name, params: {search_term: 'queen'}})?.name).toBe(
        name,
      );
    },
  );

  it('forwards the quiz events with their own parameters', () => {
    const start = buildQuizStartEvent({questionCount: 5, entryPoint: 'home'});
    expect(toGa4Call(start)).toEqual({
      name: 'quiz_start',
      params: {quiz_id: 'sleep_quiz', question_count: 5, entry_point: 'home'},
    });
  });

  it('refuses an event name outside the list, and strips personal parameters', () => {
    const rogue = {name: 'purchase', params: {}} as unknown as AnalyticsEvent;
    expect(toGa4Call(rogue)).toBeNull();
    const call = toGa4Call({
      name: 'search',
      params: {search_term: 'queen', email: 'a@b.co'},
    });
    expect(call?.params).toEqual({search_term: 'queen'});
  });

  it('builds a script URL for the id only', () => {
    expect(ga4ScriptUrl('G-ABCD1234')).toBe(
      'https://www.googletagmanager.com/gtag/js?id=G-ABCD1234',
    );
  });
});

describe('Meta mapping (REQ-ANL-002)', () => {
  it('maps the five standard events', () => {
    expect(toMetaCall({name: 'page_view', params: {}})).toEqual({
      name: 'PageView',
      params: {},
    });
    expect(toMetaCall(VIEW_ITEM)).toEqual({
      name: 'ViewContent',
      params: {
        content_type: 'product',
        content_ids: ['123'],
        content_name: 'Cloud Mattress',
        contents: [{id: '123', quantity: 1, item_price: 1999.99}],
        currency: 'USD',
        value: 1999.99,
      },
    });
    expect(toMetaCall(ADD)?.name).toBe('AddToCart');
    expect(toMetaCall(ADD)?.params.value).toBe(3999.98);
    expect(toMetaCall(CHECKOUT)).toMatchObject({
      name: 'InitiateCheckout',
      params: {num_items: 2, value: 3999.98, currency: 'USD'},
    });
    expect(
      toMetaCall({name: 'search', params: {search_term: 'firm queen'}}),
    ).toEqual({name: 'Search', params: {search_string: 'firm queen'}});
  });

  it.each([
    'view_item_list',
    'select_item',
    'remove_from_cart',
    'view_cart',
    'quiz_start',
    'quiz_complete',
    'quiz_result_click',
  ] as const)('has no standard event for %s, so nothing is sent', (name) => {
    expect(
      toMetaCall({name, params: {}, ecommerce: {items: [ITEM]}}),
    ).toBeNull();
  });

  it('sends no personal data: no name, email, phone, ZIP, order number or brand/variant text beyond the product name', () => {
    const call = toMetaCall(CHECKOUT);
    expect(JSON.stringify(call)).not.toMatch(
      /email|phone|zip|order|customer|first_name|em"|ph"/i,
    );
    expect(
      toMetaCall({name: 'search', params: {search_term: 'jane@example.com'}}),
    ).toBeNull();
  });

  it('ecommerce events without items are not sent', () => {
    expect(toMetaCall({name: 'add_to_cart', params: {}})).toBeNull();
    expect(
      toMetaCall({name: 'add_to_cart', params: {}, ecommerce: {items: []}}),
    ).toBeNull();
  });
});

describe('adapters with a fake window (injectable, no real network)', () => {
  function fakeWindow() {
    return {} as Record<string, unknown>;
  }

  it('GA4: configures privacy settings, loads the script, then sends through gtag', async () => {
    const target = fakeWindow();
    const loadScript = vi.fn(okLoader);
    const adapter = createGa4Adapter({
      measurementId: 'G-ABCD1234',
      globals: globalsOf(target),
      loadScript,
    });
    expect(await adapter.load()).toEqual({status: 'ready'});
    expect(loadScript).toHaveBeenCalledWith(
      'https://www.googletagmanager.com/gtag/js?id=G-ABCD1234',
    );
    const layer = target.dataLayer as unknown[][];
    const asArrays = layer.map((entry) =>
      Array.from(entry as ArrayLike<unknown>),
    );
    expect(asArrays[1]).toEqual([
      'config',
      'G-ABCD1234',
      {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      },
    ]);
    adapter.send(ADD);
    const last = Array.from(layer.at(-1) as ArrayLike<unknown>);
    expect(last.slice(0, 2)).toEqual(['event', 'add_to_cart']);
  });

  it('GA4: before the script loads nothing is sent; a failed load reports why and never throws', async () => {
    const target = fakeWindow();
    const adapter = createGa4Adapter({
      measurementId: 'G-ABCD1234',
      globals: globalsOf(target),
      loadScript: () => Promise.resolve({status: 'failed', reason: 'error'}),
    });
    expect(await adapter.load()).toEqual({status: 'failed', reason: 'error'});
    const before = (target.dataLayer as unknown[]).length;
    expect(() => adapter.send(ADD)).not.toThrow();
    expect((target.dataLayer as unknown[]).length).toBe(before);
  });

  it('GA4: a loader that throws is a failed result, not an exception', async () => {
    const adapter = createGa4Adapter({
      measurementId: 'G-ABCD1234',
      globals: globalsOf(fakeWindow()),
      loadScript: () => {
        throw new Error('boom');
      },
    });
    expect(await adapter.load()).toEqual({
      status: 'failed',
      reason: 'unavailable',
    });
  });

  it("GA4: revoke sets Google's disable flag, stops sending and clears its cookies; grant undoes it", async () => {
    const target = fakeWindow();
    const cleared: string[][] = [];
    const adapter = createGa4Adapter({
      measurementId: 'G-ABCD1234',
      globals: globalsOf(target),
      loadScript: okLoader,
      clearCookies: (names) => cleared.push([...names]),
    });
    await adapter.load();
    adapter.revoke();
    expect(target['ga-disable-G-ABCD1234']).toBe(true);
    expect(cleared).toEqual([['_ga', '_ga_ABCD1234']]);
    const size = (target.dataLayer as unknown[]).length;
    adapter.send(ADD);
    expect((target.dataLayer as unknown[]).length).toBe(size);
    adapter.grant();
    expect(target['ga-disable-G-ABCD1234']).toBe(false);
    adapter.send(ADD);
    expect((target.dataLayer as unknown[]).length).toBe(size + 1);
  });

  it('Meta: turns automatic configuration off before init, loads, then tracks with standard parameters', async () => {
    const target = fakeWindow();
    const adapter = createMetaAdapter({
      pixelId: '123456789012345',
      globals: globalsOf(target),
      loadScript: okLoader,
    });
    expect(await adapter.load()).toEqual({status: 'ready'});
    const fbq = target.fbq as {queue: unknown[]};
    const calls = fbq.queue.map((entry) =>
      Array.from(entry as ArrayLike<unknown>),
    );
    expect(calls.slice(0, 3)).toEqual([
      ['set', 'autoConfig', false, '123456789012345'],
      ['consent', 'grant'],
      ['init', '123456789012345'],
    ]);
    adapter.send(ADD);
    const last = Array.from(fbq.queue.at(-1) as ArrayLike<unknown>);
    expect(last.slice(0, 2)).toEqual(['track', 'AddToCart']);
  });

  it("Meta: the script URL is Meta's library over https and nothing else", async () => {
    const loadScript = vi.fn(okLoader);
    await createMetaAdapter({
      pixelId: '123456789012345',
      globals: globalsOf(fakeWindow()),
      loadScript,
    }).load();
    expect(loadScript).toHaveBeenCalledWith(META_SCRIPT_URL);
    expect(META_SCRIPT_URL.startsWith('https://connect.facebook.net/')).toBe(
      true,
    );
  });

  it('Meta: revoke withdraws consent, clears _fbp and _fbc and stops sending', async () => {
    const target = fakeWindow();
    const cleared: string[][] = [];
    const adapter = createMetaAdapter({
      pixelId: '123456789012345',
      globals: globalsOf(target),
      loadScript: okLoader,
      clearCookies: (names) => cleared.push([...names]),
    });
    await adapter.load();
    adapter.revoke();
    const fbq = target.fbq as {queue: unknown[]};
    expect(Array.from(fbq.queue.at(-1) as ArrayLike<unknown>)).toEqual([
      'consent',
      'revoke',
    ]);
    expect(cleared).toEqual([['_fbp', '_fbc']]);
    const size = fbq.queue.length;
    adapter.send(ADD);
    expect(fbq.queue.length).toBe(size);
  });

  it('Meta: a failed load is a result', async () => {
    const adapter = createMetaAdapter({
      pixelId: '123456789012345',
      globals: globalsOf(fakeWindow()),
      loadScript: () => Promise.resolve({status: 'failed', reason: 'timeout'}),
    });
    expect(await adapter.load()).toEqual({status: 'failed', reason: 'timeout'});
  });

  it('adapters never throw from send even when the provider global misbehaves', async () => {
    const target = fakeWindow();
    const adapter: ProviderAdapter = createMetaAdapter({
      pixelId: '123456789012345',
      globals: globalsOf(target),
      loadScript: okLoader,
    });
    await adapter.load();
    target.fbq = () => {
      throw new Error('provider bug');
    };
    expect(() => adapter.send(ADD)).not.toThrow();
  });
});

describe('script loader (NFR-013: blocked, failed and slow loads)', () => {
  it('appends an async script with the nonce and resolves loaded', async () => {
    const load = createScriptLoader({
      doc: document,
      nonce: () => 'abc123nonce',
    });
    const pending = load(
      'https://www.googletagmanager.com/gtag/js?id=G-ABCD1234',
    );
    const script = document.head.querySelector('script');
    expect(script?.async).toBe(true);
    expect(script?.nonce).toBe('abc123nonce');
    script?.dispatchEvent(new Event('load'));
    expect(await pending).toEqual({status: 'loaded'});
  });

  it('an ad blocker or CSP refusal (error event) is a failed result', async () => {
    const load = createScriptLoader({doc: document});
    const pending = load('https://connect.facebook.net/en_US/fbevents.js');
    document.head.querySelector('script')?.dispatchEvent(new Event('error'));
    expect(await pending).toEqual({status: 'failed', reason: 'error'});
  });

  it('a script that never answers times out instead of waiting forever', async () => {
    vi.useFakeTimers();
    try {
      const load = createScriptLoader({doc: document, timeoutMs: 500});
      const pending = load('https://connect.facebook.net/en_US/fbevents.js');
      await vi.advanceTimersByTimeAsync(501);
      expect(await pending).toEqual({status: 'failed', reason: 'timeout'});
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles once: a late load after a timeout changes nothing', async () => {
    vi.useFakeTimers();
    try {
      const load = createScriptLoader({doc: document, timeoutMs: 100});
      const pending = load('https://connect.facebook.net/en_US/fbevents.js');
      await vi.advanceTimersByTimeAsync(101);
      document.head.querySelector('script')?.dispatchEvent(new Event('load'));
      expect(await pending).toEqual({status: 'failed', reason: 'timeout'});
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['plain http', 'http://www.googletagmanager.com/gtag/js'],
    ['another host', 'https://evil.example/gtag/js'],
    ['a look-alike host', 'https://www.googletagmanager.com.evil.example/x.js'],
    ['user-info trick', 'https://www.googletagmanager.com@evil.example/x.js'],
    ['a data URL', 'data:text/javascript,alert(1)'],
    ['junk', 'not a url'],
  ])('refuses %s without adding a script', async (_label, src) => {
    const load = createScriptLoader({doc: document});
    expect(await load(src)).toEqual({
      status: 'failed',
      reason: 'origin-refused',
    });
    expect(document.head.querySelector('script')).toBeNull();
  });

  it('a document that cannot take a script is a failed result, not an exception', async () => {
    const broken = {
      createElement: () => {
        throw new Error('no');
      },
    } as unknown as Document;
    const load = createScriptLoader({doc: broken});
    expect(
      await load('https://connect.facebook.net/en_US/fbevents.js'),
    ).toEqual({status: 'failed', reason: 'unavailable'});
  });
});

describe('cookie clearing on withdrawal', () => {
  it('expires each name on the host and its dotted form, and ignores unsafe names or hosts', () => {
    const lines = buildExpiredCookies(
      ['_ga', 'bad name;x'],
      'shop.example.com',
    );
    // host-only, then each of the two suffixes with and without the leading dot
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('_ga=;');
    expect(
      lines.some((line) => line.includes('Domain=.shop.example.com')),
    ).toBe(true);
    expect(lines.join('\n')).not.toContain('bad name');
    expect(buildExpiredCookies(['_ga'], 'bad host;x')).toHaveLength(1);
  });

  it('also expires on every parent suffix of two labels or more, where GA4 and the pixel really set them (review L-2)', () => {
    const lines = buildExpiredCookies(['_fbp'], 'www.shop.example.com');
    const domains = lines
      .map((line) => /Domain=([^;]+)/.exec(line)?.[1])
      .filter((domain) => domain !== undefined);
    expect(domains).toEqual([
      'www.shop.example.com',
      '.www.shop.example.com',
      'shop.example.com',
      '.shop.example.com',
      'example.com',
      '.example.com',
    ]);
    // Never the bare top-level label.
    expect(domains).not.toContain('com');
    expect(domains).not.toContain('.com');
  });

  it.each([
    ['www.example.com', ['www.example.com', 'example.com']],
    ['example.com', ['example.com']],
    ['a.b.co.uk', ['a.b.co.uk', 'b.co.uk', 'co.uk']],
    ['localhost', []],
    ['127.0.0.1', []],
    ['bad host;x', []],
    ['', []],
  ])('suffixes of %j', (hostname, expected) => {
    expect(hostSuffixes(hostname)).toEqual(expected);
  });
});
