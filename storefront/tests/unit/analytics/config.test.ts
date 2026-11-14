import {describe, expect, it} from 'vitest';
import {
  configuredCategories,
  hasProviders,
  parseAnalyticsConfig,
  parseGa4MeasurementId,
  parseMetaPixelId,
  rejectedAnalyticsEnvNames,
} from '~/lib/analytics/config';
// P7-01: the id parsing that decides whether anything loads at all. REQ-ANL-001, REQ-ANL-002.

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
      ga4MeasurementId: null,
      metaPixelId: null,
      openaiPixelId: null,
      gtmContainerId: null,
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
