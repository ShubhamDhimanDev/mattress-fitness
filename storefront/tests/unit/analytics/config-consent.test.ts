import {describe, expect, it} from 'vitest';
import {
  configuredCategories,
  hasProviders,
  parseAnalyticsConfig,
  parseConsentMode,
  parseGa4MeasurementId,
  parseMetaPixelId,
  rejectedAnalyticsEnvNames,
} from '~/lib/analytics/config';
import {
  CONSENT_MAX_AGE_SECONDS,
  CONSENT_POLICY_VERSION,
  buildConsentCookie,
  defaultChoice,
  effectiveChoice,
  parseStoredConsent,
  readCookieValue,
  serializeConsent,
} from '~/lib/analytics/consent';
import {createConsentStore} from '~/lib/analytics/consent-store';

// P7-01, NFR-011: the consent mode switch, the id parsing that decides whether anything loads at all, and what a
// stored decision means. REQ-ANL-001, REQ-ANL-002.

describe('PUBLIC_CONSENT_MODE (NFR-011)', () => {
  it.each([
    [undefined, 'opt-in'],
    ['', 'opt-in'],
    ['opt-in', 'opt-in'],
    ['opt-out', 'opt-out'],
    // Exact match only (review I-1): case, spaces and typos keep the stricter mode.
    ['OPT-OUT', 'opt-in'],
    [' opt-out ', 'opt-in'],
    ['opt-out\n', 'opt-in'],
    ['optout', 'opt-in'],
    ['false', 'opt-in'],
    ['opt-out; drop table', 'opt-in'],
  ])('%j gives %s (anything unknown is the stricter opt-in)', (value, mode) => {
    expect(parseConsentMode(value)).toBe(mode);
  });
});

describe('provider ids (REQ-ANL-001, REQ-ANL-002)', () => {
  it.each([
    ['G-ABC123DEF4', 'G-ABC123DEF4'],
    ['g-abc123def4', 'G-ABC123DEF4'],
    [' G-ABCD1234 ', 'G-ABCD1234'],
  ])('accepts the GA4 id %j', (value, expected) => {
    expect(parseGa4MeasurementId(value)).toBe(expected);
  });

  it.each([
    undefined,
    '',
    'UA-12345-1',
    'GTM-ABC123',
    'G-',
    'G-AB',
    'G-ABC123"><script>',
    'G-ABC 123',
    'https://www.googletagmanager.com/gtag/js?id=G-ABC123',
  ])('refuses the GA4 id %j', (value) => {
    expect(parseGa4MeasurementId(value)).toBeNull();
  });

  it.each([['1234567890123456'], [' 123456789012345 ']])(
    'accepts the Meta pixel id %j',
    (value) => {
      expect(parseMetaPixelId(value)).toBe(value.trim());
    },
  );

  it.each([
    undefined,
    '',
    '12',
    'abc',
    '1234567890123456; x',
    '1.5e9',
    '-12345678',
  ])('refuses the Meta pixel id %j', (value) => {
    expect(parseMetaPixelId(value)).toBeNull();
  });

  it('with both ids unset there is no provider and nothing to ask about', () => {
    const config = parseAnalyticsConfig({});
    expect(config).toEqual({
      consentMode: 'opt-in',
      ga4MeasurementId: null,
      metaPixelId: null,
    });
    expect(hasProviders(config)).toBe(false);
    expect(configuredCategories(config)).toEqual([]);
  });

  it('each provider needs its own category', () => {
    expect(
      configuredCategories(
        parseAnalyticsConfig({PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'}),
      ),
    ).toEqual(['analytics']);
    expect(
      configuredCategories(
        parseAnalyticsConfig({PUBLIC_META_PIXEL_ID: '123456789012345'}),
      ),
    ).toEqual(['marketing']);
  });

  it('names a set-but-unusable variable without echoing its value', () => {
    const rejected = rejectedAnalyticsEnvNames({
      PUBLIC_GA4_MEASUREMENT_ID: 'UA-1',
      PUBLIC_META_PIXEL_ID: '123456789012345',
    });
    expect(rejected).toEqual(['PUBLIC_GA4_MEASUREMENT_ID']);
  });
});

describe('stored consent', () => {
  const NOW = 1_800_000_000;

  it('round-trips a decision', () => {
    const raw = serializeConsent({analytics: true, marketing: false}, NOW);
    expect(parseStoredConsent(raw, NOW + 60)).toEqual({
      version: CONSENT_POLICY_VERSION,
      analytics: true,
      marketing: false,
      decidedAt: NOW,
    });
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['not JSON', '{nope'],
    ['an array', '[]'],
    ['a string', '"yes"'],
    [
      'a missing field',
      JSON.stringify({version: 1, analytics: true, decidedAt: NOW}),
    ],
    [
      'a string boolean',
      JSON.stringify({
        version: 1,
        analytics: 'true',
        marketing: false,
        decidedAt: NOW,
      }),
    ],
    [
      'an older policy version',
      JSON.stringify({
        version: 0,
        analytics: true,
        marketing: true,
        decidedAt: NOW,
      }),
    ],
    [
      'a non-finite date',
      '{"version":1,"analytics":true,"marketing":true,"decidedAt":1e999}',
    ],
    ['an oversized value', 'x'.repeat(500)],
  ])('treats %s as no decision, never a partial one', (_label, raw) => {
    expect(parseStoredConsent(raw, NOW)).toBeNull();
  });

  it('expires after the maximum age and refuses a date in the far future', () => {
    const raw = serializeConsent({analytics: true, marketing: true}, NOW);
    expect(
      parseStoredConsent(raw, NOW + CONSENT_MAX_AGE_SECONDS),
    ).not.toBeNull();
    expect(
      parseStoredConsent(raw, NOW + CONSENT_MAX_AGE_SECONDS + 1),
    ).toBeNull();
    expect(parseStoredConsent(raw, NOW - 3 * 24 * 60 * 60)).toBeNull();
  });
});

describe('defaults while undecided (NFR-011, T-16)', () => {
  it('opt-in allows nothing', () => {
    expect(defaultChoice('opt-in', false)).toEqual({
      analytics: false,
      marketing: false,
    });
    expect(defaultChoice('opt-in', true)).toEqual({
      analytics: false,
      marketing: false,
    });
  });

  it('opt-out allows analytics, and marketing unless Global Privacy Control is on', () => {
    expect(defaultChoice('opt-out', false)).toEqual({
      analytics: true,
      marketing: true,
    });
    expect(defaultChoice('opt-out', true)).toEqual({
      analytics: true,
      marketing: false,
    });
  });

  it('a stored decision beats the default in both modes', () => {
    const stored = parseStoredConsent(
      serializeConsent({analytics: false, marketing: false}, 1_800_000_000),
      1_800_000_000,
    );
    expect(effectiveChoice('opt-out', stored, false)).toEqual({
      analytics: false,
      marketing: false,
    });
  });
});

describe('cookie helpers', () => {
  it('reads a value out of a cookie header', () => {
    expect(
      readCookieValue('a=1; mf_consent=%7B%22x%22%3A1%7D; b=2', 'mf_consent'),
    ).toBe('{"x":1}');
    expect(readCookieValue('a=1', 'mf_consent')).toBeNull();
    expect(readCookieValue(null, 'mf_consent')).toBeNull();
    expect(readCookieValue('mf_consent=%E0%A4%A', 'mf_consent')).toBeNull();
  });

  it('builds a first-party, same-site cookie; Secure only on https; no domain', () => {
    const https = buildConsentCookie('v', {secure: true});
    expect(https).toContain('Path=/');
    expect(https).toContain('SameSite=Lax');
    expect(https).toContain('Secure');
    expect(https).not.toMatch(/Domain=/i);
    expect(buildConsentCookie('v', {secure: false})).not.toContain('Secure');
  });
});

describe('consent store', () => {
  function memoryStorage(initial: string | null = null) {
    let value = initial;
    return {
      read: () => value,
      write: (next: string) => {
        value = next;
      },
      peek: () => value,
    };
  }

  it('opt-in starts undecided with nothing allowed; accept all allows both and remembers it', () => {
    const storage = memoryStorage();
    const store = createConsentStore({mode: 'opt-in', storage});
    expect(store.getSnapshot()).toMatchObject({
      decided: false,
      choice: {analytics: false, marketing: false},
    });
    store.acceptAll();
    expect(store.getSnapshot()).toMatchObject({
      decided: true,
      choice: {analytics: true, marketing: true},
    });
    const again = createConsentStore({mode: 'opt-in', storage});
    expect(again.getSnapshot().choice).toEqual({
      analytics: true,
      marketing: true,
    });
  });

  it('reject all is a decision too, so the banner does not return', () => {
    const store = createConsentStore({
      mode: 'opt-in',
      storage: memoryStorage(),
    });
    store.rejectAll();
    expect(store.getSnapshot()).toMatchObject({
      decided: true,
      choice: {analytics: false, marketing: false},
    });
  });

  it('keeps the choice for the visit when storage throws on read and write', () => {
    const store = createConsentStore({
      mode: 'opt-in',
      storage: {
        read: () => {
          throw new Error('blocked');
        },
        write: () => {
          throw new Error('full');
        },
      },
    });
    expect(store.getSnapshot().decided).toBe(false);
    expect(() => store.save({analytics: true, marketing: false})).not.toThrow();
    expect(store.getSnapshot().choice).toEqual({
      analytics: true,
      marketing: false,
    });
  });

  it('ignores a tampered stored value and asks again', () => {
    const store = createConsentStore({
      mode: 'opt-in',
      storage: memoryStorage('{"analytics":true}'),
    });
    expect(store.getSnapshot()).toMatchObject({
      decided: false,
      choice: {analytics: false},
    });
  });

  it('changes the snapshot object only when its content changes, and notifies once per change', () => {
    const store = createConsentStore({
      mode: 'opt-in',
      storage: memoryStorage(),
    });
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    const first = store.getSnapshot();
    store.closePreferences();
    expect(store.getSnapshot()).toBe(first);
    store.openPreferences();
    store.openPreferences();
    expect(calls).toBe(1);
    store.save({analytics: true, marketing: true});
    expect(store.getSnapshot().preferencesOpen).toBe(false);
    unsubscribe();
    store.rejectAll();
    expect(calls).toBe(2);
  });

  it('a faulty listener does not stop the others', () => {
    const store = createConsentStore({
      mode: 'opt-in',
      storage: memoryStorage(),
    });
    const seen: string[] = [];
    store.subscribe(() => {
      throw new Error('bad');
    });
    store.subscribe(() => seen.push('ok'));
    store.acceptAll();
    expect(seen).toEqual(['ok']);
  });

  it('refresh picks up a decision made in another tab', () => {
    const storage = memoryStorage();
    const store = createConsentStore({mode: 'opt-in', storage});
    storage.write(
      serializeConsent({analytics: true, marketing: false}, Date.now() / 1000),
    );
    store.refresh();
    expect(store.getSnapshot().choice).toEqual({
      analytics: true,
      marketing: false,
    });
  });

  it('opt-out honours Global Privacy Control for marketing until the shopper decides', () => {
    let gpc = true;
    const store = createConsentStore({
      mode: 'opt-out',
      storage: memoryStorage(),
      gpc: () => gpc,
    });
    expect(store.getSnapshot().choice).toEqual({
      analytics: true,
      marketing: false,
    });
    gpc = false;
    store.refresh();
    expect(store.getSnapshot().choice).toEqual({
      analytics: true,
      marketing: true,
    });
  });
});
