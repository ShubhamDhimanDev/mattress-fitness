import {readFileSync} from 'node:fs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import settingsFixture from '../../fixtures/shopify/site-settings.json';
import {fakeStorefront} from './fake-storefront';
import {
  MAX_PROMO_TEXT_LENGTH,
  NO_SITE_SETTINGS,
  SITE_SETTINGS_FIELDS,
  SITE_SETTINGS_QUERY,
  chooseSupportPhone,
  loadSiteSettings,
  mapSiteSettings,
} from '~/lib/shopify/site-settings';

// P3B-13 follow-up, REQ-NAV-001, REQ-CNT-001, B-15, T-07, T-08: the promotion bar text and the support phone come
// from the site_settings entry in Shopify admin, as plain text, and are hidden when empty or unusable.

afterEach(() => vi.restoreAllMocks());

type Nodes = Parameters<typeof mapSiteSettings>[0];

function entry(fields: Record<string, string | null>): Nodes {
  return [
    {
      id: 'gid://shopify/Metaobject/1',
      fields: Object.entries(fields).map(([key, value]) => ({key, value})),
    },
  ];
}

describe('mapSiteSettings', () => {
  it('reads the promotion message and the phone from the recorded entry', () => {
    expect(mapSiteSettings(settingsFixture.settings.nodes)).toEqual({
      promo: {
        text: 'Free in-home delivery on every queen and king mattress',
        to: '/collections/mattresses',
        external: false,
      },
      supportPhoneRaw: '(312) 555-0142',
    });
  });

  it('returns nothing for no entry, an empty entry and empty fields (the bar and the phone stay hidden)', () => {
    expect(mapSiteSettings([])).toEqual(NO_SITE_SETTINGS);
    expect(mapSiteSettings(entry({}))).toEqual(NO_SITE_SETTINGS);
    expect(
      mapSiteSettings(
        entry({
          promo_bar_text: '',
          promo_bar_link: '/pages/x',
          support_phone: null,
        }),
      ),
    ).toEqual(NO_SITE_SETTINGS);
    expect(
      mapSiteSettings(entry({promo_bar_text: '   \n\t '})).promo,
    ).toBeNull();
  });

  it('shows text without a link when the link is empty or not allowed', () => {
    const links = [
      null,
      '',
      'javascript:alert(1)',
      '//evil.example/x',
      'http://insecure.example',
      '/account/orders',
      '/cart',
      '/pages/../account',
      '/pages/a b',
    ];
    for (const link of links) {
      expect(
        mapSiteSettings(entry({promo_bar_text: 'Sale', promo_bar_link: link}))
          .promo,
      ).toEqual({text: 'Sale'});
    }
  });

  it('keeps an https link and marks it external', () => {
    expect(
      mapSiteSettings(
        entry({
          promo_bar_text: 'Sale',
          promo_bar_link: 'https://example.com/sale',
        }),
      ).promo,
    ).toEqual({text: 'Sale', to: 'https://example.com/sale', external: true});
  });

  it('reduces the text to plain text: tags, control and invisible characters, whitespace', () => {
    // Zero-width space and right-to-left override, built from code points so this file holds no invisible text.
    const zeroWidth = String.fromCodePoint(0x200b);
    const override = String.fromCodePoint(0x202e);
    const hostile = [
      '  <script>alert(1)</script><b>Big</b>',
      zeroWidth,
      '   sale',
      override,
      ' \n today  ',
    ].join('');
    const {promo} = mapSiteSettings(entry({promo_bar_text: hostile}));
    expect(promo?.text).toBe('alert(1)Big sale today');
    for (const char of ['<', '>', zeroWidth, override, '\n']) {
      expect(promo?.text).not.toContain(char);
    }
  });

  it('cuts text to one line of sensible length', () => {
    const {promo} = mapSiteSettings(entry({promo_bar_text: 'a'.repeat(500)}));
    expect(promo?.text).toHaveLength(MAX_PROMO_TEXT_LENGTH);
  });

  it('uses only the first entry', () => {
    const nodes: Nodes = [
      ...entry({promo_bar_text: 'First'}),
      ...entry({promo_bar_text: 'Second'}),
    ];
    expect(mapSiteSettings(nodes).promo?.text).toBe('First');
  });
});

describe('chooseSupportPhone', () => {
  const admin = (value: string | null) => ({
    promo: null,
    supportPhoneRaw: value,
  });

  it.each([
    [
      'env wins over admin',
      '(212) 555-0100',
      '(312) 555-0142',
      false,
      '(212) 555-0100',
    ],
    ['admin when env is empty', '', '(312) 555-0142', false, '(312) 555-0142'],
    [
      'admin when env is invalid',
      'call us',
      '+1 312 555 0142',
      false,
      '(312) 555-0142',
    ],
    ['env alone', '2125550100', null, false, '(212) 555-0100'],
    ['neither, in production', undefined, null, false, null],
    [
      'an invalid admin number, in production',
      undefined,
      '555-0142',
      false,
      null,
    ],
    [
      'neither, in development: the labelled placeholder',
      undefined,
      null,
      true,
      '1-800-555-0100 (dev placeholder)',
    ],
    [
      'a valid admin number in development hides the placeholder',
      undefined,
      '(312) 555-0142',
      true,
      '(312) 555-0142',
    ],
  ])('%s', (_name, env, adminValue, isDev, expected) => {
    expect(
      chooseSupportPhone(env, admin(adminValue), isDev)?.display ?? null,
    ).toBe(expected);
  });

  it('builds a tel link from the validated number only', () => {
    expect(
      chooseSupportPhone(undefined, admin('(312) 555-0142'), false),
    ).toEqual({display: '(312) 555-0142', href: 'tel:+13125550142'});
    for (const hostile of [
      'javascript:alert(1)',
      '+44 20 7946 0958',
      '312-555-0142 ext 5',
      '<b>312</b>',
    ]) {
      expect(chooseSupportPhone(undefined, admin(hostile), false)).toBeNull();
    }
  });
});

describe('loadSiteSettings', () => {
  it('asks for the site_settings entry with the long cache (no price or availability is read)', async () => {
    const {storefront, calls} = fakeStorefront(() => settingsFixture);
    const settings = await loadSiteSettings(storefront);
    expect(settings.promo?.text).toContain('Free in-home delivery');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toBe(SITE_SETTINGS_QUERY);
    expect(calls[0]?.query).toContain('type: "site_settings"');
    expect(calls[0]?.cache).toEqual({mode: 'long'});
    // No product, variant or money field can sit in a long-cached query (DEC-024).
    expect(calls[0]?.query).not.toMatch(/price|availab|amount|variant/i);
  });

  it('falls back to nothing, and logs only the error class, when the read fails', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const {storefront} = fakeStorefront(() => {
      throw new TypeError('fetch failed: token shpat_secret jane@example.com');
    });
    expect(await loadSiteSettings(storefront)).toEqual(NO_SITE_SETTINGS);
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toContain('root.site_settings_read_failed');
    expect(line).toContain('"errorName":"TypeError"');
    expect(line).not.toContain('shpat');
    expect(line).not.toContain('jane@');
  });
});

describe('definitions.json and the code agree on the site_settings fields', () => {
  it('defines every field the storefront reads, as plain text, readable by the Storefront API', () => {
    const spec = JSON.parse(
      readFileSync(
        new URL(
          '../../../../scripts/shopify/definitions.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as {
      metaobjectDefinitions: {
        type: string;
        storefrontAccess: string;
        fieldDefinitions: {key: string; type: string}[];
      }[];
    };
    const definition = spec.metaobjectDefinitions.find(
      (candidate) => candidate.type === 'site_settings',
    );
    expect(definition?.storefrontAccess).toBe('PUBLIC_READ');
    for (const key of Object.values(SITE_SETTINGS_FIELDS)) {
      expect(
        definition?.fieldDefinitions.find((field) => field.key === key)?.type,
        key,
      ).toBe('single_line_text_field');
    }
  });
});
