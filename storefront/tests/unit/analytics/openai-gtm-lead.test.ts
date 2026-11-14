// @vitest-environment jsdom
import {describe, expect, it} from 'vitest';
import type {AnalyticsEvent} from '~/lib/analytics';
import {globalsOf, type ScriptLoader} from '~/lib/analytics/adapter';
import {
  configuredCategories,
  parseAnalyticsConfig,
  parseGtmContainerId,
  parseOpenaiPixelId,
  rejectedAnalyticsEnvNames,
} from '~/lib/analytics/config';
import {createGtmAdapter, toGtmPushes} from '~/lib/analytics/gtm';
import {toMetaCall} from '~/lib/analytics/meta';
import {
  createOpenaiAdapter,
  OPENAI_SCRIPT_URL,
  toOpenaiCall,
} from '~/lib/analytics/openai';
import {analyticsCspHosts, enforcedCspExtras} from '~/lib/security-headers';
import {validateLeadForm} from '~/lib/leads/lead-form';

// CR-33: OpenAI pixel, Tag Manager and the lead form event. UNVERIFIED against the providers' own tooling.

const LEAD: AnalyticsEvent = {name: 'generate_lead', params: {}};
const VIEW: AnalyticsEvent = {name: 'page_view', params: {}};
const okLoader: ScriptLoader = () => Promise.resolve({status: 'loaded'});

function queuedCalls(win: object, key: string, prop: string): unknown[][] {
  const holder: unknown = Reflect.get(win, key);
  const queue: unknown = holder ? Reflect.get(holder, prop) : undefined;
  if (!Array.isArray(queue)) return [];
  return queue.map((args: unknown) => Array.from(args as ArrayLike<unknown>));
}

describe('configuration', () => {
  it('parses both ids and refuses junk', () => {
    expect(parseOpenaiPixelId('4VZjrYfW1zkybWdqPEHjbb')).toBe(
      '4VZjrYfW1zkybWdqPEHjbb',
    );
    expect(parseOpenaiPixelId('a"b')).toBeNull();
    expect(parseGtmContainerId(' gtm-pqxj6c4k ')).toBe('GTM-PQXJ6C4K');
    expect(parseGtmContainerId('G-ABCD1234')).toBeNull();
    expect(
      rejectedAnalyticsEnvNames({
        PUBLIC_OPENAI_PIXEL_ID: 'a b',
        PUBLIC_GTM_CONTAINER_ID: 'x',
      }),
    ).toEqual(['PUBLIC_OPENAI_PIXEL_ID', 'PUBLIC_GTM_CONTAINER_ID']);
  });

  it('GTM needs analytics consent and the OpenAI pixel marketing consent', () => {
    const gtm = parseAnalyticsConfig({PUBLIC_GTM_CONTAINER_ID: 'GTM-PQXJ6C4K'});
    const openai = parseAnalyticsConfig({
      PUBLIC_OPENAI_PIXEL_ID: '4VZjrYfW1zkybWdqPEHjbb',
    });
    expect(configuredCategories(gtm)).toEqual(['analytics']);
    expect(configuredCategories(openai)).toEqual(['marketing']);
  });

  it('adds hosts only for a configured provider, each once', () => {
    expect(analyticsCspHosts({openai: true}).script).toEqual([
      'https://bzrcdn.openai.com',
    ]);
    expect(analyticsCspHosts({openai: true}).connect).toEqual([
      'https://bzr.openai.com',
      'https://bzrcdn.openai.com',
    ]);
    const both = analyticsCspHosts({ga4: true, gtm: true});
    expect(new Set(both.script).size).toBe(both.script.length);
    expect(analyticsCspHosts({}).script).toEqual([]);
  });
});

describe('lead event mapping', () => {
  it('sends OpenAI lead_created with no personal data, and nothing else', () => {
    expect(toOpenaiCall(LEAD)).toEqual({
      name: 'lead_created',
      props: {type: 'customer_action'},
    });
    expect(toOpenaiCall(VIEW)).toBeNull();
  });

  it('sends Meta Lead with no parameters', () => {
    expect(toMetaCall(LEAD)).toEqual({name: 'Lead', params: {}});
  });

  it('GTM pushes the GA4 event, ecommerce under its own key', () => {
    expect(toGtmPushes(LEAD)).toEqual([{event: 'generate_lead'}]);
    const pushes = toGtmPushes({
      name: 'add_to_cart',
      params: {},
      ecommerce: {
        valueCents: 1000,
        items: [{id: '1', name: 'Bed', priceCents: 1000, quantity: 1}],
      },
    });
    expect(pushes[0]).toEqual({ecommerce: null});
    expect(pushes[1]).toMatchObject({
      event: 'add_to_cart',
      ecommerce: {currency: 'USD', value: 10},
    });
  });
});

describe('OpenAI adapter', () => {
  it('initialises with debug off, grants consent, then measures a lead', async () => {
    const win = {};
    const adapter = createOpenaiAdapter({
      pixelId: 'PIXEL1234',
      globals: globalsOf(win),
      loadScript: okLoader,
    });
    expect(adapter.category).toBe('marketing');
    await expect(adapter.load()).resolves.toEqual({status: 'ready'});
    adapter.send(LEAD);
    expect(queuedCalls(win, 'oaiq', 'q')).toEqual([
      ['init', {pixelId: 'PIXEL1234', debug: false}],
      ['consent', true],
      ['measure', 'lead_created', {type: 'customer_action'}],
    ]);
  });

  it('sends nothing after withdrawal and reports a failed script', async () => {
    const win = {};
    const adapter = createOpenaiAdapter({
      pixelId: 'PIXEL1234',
      globals: globalsOf(win),
      loadScript: okLoader,
    });
    await adapter.load();
    adapter.revoke();
    adapter.send(LEAD);
    // init, consent true, consent false: no measure call after the withdrawal.
    expect(queuedCalls(win, 'oaiq', 'q')).toHaveLength(3);
    const failing = createOpenaiAdapter({
      pixelId: 'PIXEL1234',
      globals: globalsOf({}),
      loadScript: () =>
        Promise.resolve({status: 'failed', reason: 'error'} as const),
    });
    await expect(failing.load()).resolves.toEqual({
      status: 'failed',
      reason: 'error',
    });
    expect(OPENAI_SCRIPT_URL).toBe('https://bzrcdn.openai.com/sdk/oaiq.min.js');
  });
});

describe('GTM adapter', () => {
  it('grants consent, starts the container, then forwards events', async () => {
    const win = {};
    const adapter = createGtmAdapter({
      containerId: 'GTM-PQXJ6C4K',
      globals: globalsOf(win),
      loadScript: okLoader,
    });
    expect(adapter.category).toBe('analytics');
    await adapter.load();
    adapter.send(LEAD);
    const layer: unknown = Reflect.get(win, 'dataLayer');
    if (!Array.isArray(layer)) throw new Error('no data layer');
    const first = Array.from(layer[0] as ArrayLike<unknown>);
    expect(first.slice(0, 2)).toEqual(['consent', 'default']);
    expect(first[2]).toMatchObject({ad_storage: 'granted'});
    expect(layer[1]).toMatchObject({event: 'gtm.js'});
    expect(layer[2]).toEqual({event: 'generate_lead'});
    adapter.pause?.();
    adapter.send(LEAD);
    expect(layer).toHaveLength(3);
  });
});

describe('lead form validation', () => {
  const GOOD = {
    budget: '1000-1499',
    visitWindow: 'within-7-days',
    name: 'Sam Lee',
    phone: '(312) 555-0148',
    zip: '60601',
  };

  it('accepts a complete form', () => {
    expect(validateLeadForm(GOOD)).toEqual({ok: true});
  });

  it('flags each bad field', () => {
    const result = validateLeadForm({
      budget: 'x',
      visitWindow: '',
      name: '  ',
      phone: '123',
      zip: '1234',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        'budget',
        'name',
        'phone',
        'visitWindow',
        'zip',
      ]);
    }
  });
});

describe('Tag Manager containers that hold Google Ads tags', () => {
  it('get the Google Ads hosts and the Tag Manager frame, only when a container id is set', () => {
    const gtm = analyticsCspHosts({gtm: true});
    expect(gtm.script).toEqual(
      expect.arrayContaining([
        'https://www.googletagmanager.com',
        'https://www.googleadservices.com',
        'https://www.google.com',
      ]),
    );
    expect(gtm.connect).toEqual(
      expect.arrayContaining([
        'https://googleads.g.doubleclick.net',
        'https://pagead2.googlesyndication.com',
      ]),
    );
    expect(gtm.frame).toEqual(['https://www.googletagmanager.com']);
    expect(analyticsCspHosts({ga4: true}).script).not.toContain(
      'https://www.googleadservices.com',
    );
    const enforced = enforcedCspExtras({gtm: true});
    expect(enforced.frameSrc).toContain('https://www.googletagmanager.com');
    expect(enforcedCspExtras({ga4: true}).frameSrc).not.toContain(
      'https://www.googletagmanager.com',
    );
  });
});
