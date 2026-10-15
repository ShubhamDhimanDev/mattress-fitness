// Site settings edited in Shopify admin (P3B-13 follow-up, REQ-NAV-001, REQ-CNT-001, B-15): the promotion bar
// text and link, and the support phone. One `site_settings` metaobject entry; everything here is pure except
// `loadSiteSettings`, which only runs the query. The entry is untrusted text (T-07, T-15): the bar text is
// reduced to plain text, the link goes through the same allow-list as every admin link (T-08) and the phone
// must be a valid US number, or it is ignored.
//
// The promotion text is free text typed in admin and may quote a price or a date ("$100 off until Friday"),
// so the read uses the same 60 s / 300 s strategy as every priced read (DEC-024), not the long cache: a stale
// offer must not outlive its end date by hours. An edit in admin shows within that window. An absent entry, an
// empty field or a failed read all mean "show nothing", never an invented message or number (B-15).

import type {Storefront} from '@shopify/hydrogen';
import type {SiteSettingsQuery} from 'storefrontapi.generated';
import {cleanText} from '~/lib/catalog/text';
import {errorFields, logError} from '~/lib/logging/logger';
import {
  resolveSupportPhone,
  type PromoMessage,
  type SupportPhone,
} from '~/lib/navigation';
import {parseAdminLink} from '~/lib/shopify/admin-link';
import {pricedCache} from '~/lib/shopify/cache';
import {fieldRecord} from '~/lib/shopify/common';

export const SITE_SETTINGS_FIELDS = {
  promoBarText: 'promo_bar_text',
  promoBarLink: 'promo_bar_link',
  supportPhone: 'support_phone',
} as const;

/** One line above the header: longer text would wrap into a block on a phone, so it is cut. */
export const MAX_PROMO_TEXT_LENGTH = 140;

/**
 * The single `site_settings` entry. Only the fields of the entry come back (Shopify cannot filter them), and
 * the mapper below reads three of them; the haul-away maximum and the Extend mirror are read elsewhere.
 */
export const SITE_SETTINGS_QUERY = `#graphql
  query SiteSettings($country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    settings: metaobjects(type: "site_settings", first: 1) {
      nodes {
        id
        fields {
          key
          value
        }
      }
    }
  }
` as const;

export type SiteSettings = {
  /** Null hides the promotion bar. */
  readonly promo: PromoMessage | null;
  /** The raw admin value; validated by `chooseSupportPhone`, which also weighs the deployment setting. */
  readonly supportPhoneRaw: string | null;
};

export const NO_SITE_SETTINGS: SiteSettings = {
  promo: null,
  supportPhoneRaw: null,
};

type SettingsNodes = SiteSettingsQuery['settings']['nodes'];

/**
 * At most `max` characters, counted as code points: `String.slice` counts UTF-16 units and can cut an emoji
 * (a surrogate pair) in half, which renders as a replacement character. A multi-code-point emoji (a skin tone or
 * a joined family) can still lose its tail, which only shortens the picture, never corrupts the text.
 */
export function truncateCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join('');
}

function promoFrom(fields: Readonly<Record<string, string>>) {
  const raw = fields[SITE_SETTINGS_FIELDS.promoBarText];
  const text = raw === undefined ? '' : cleanText(raw);
  if (text === '') return null;
  const link = parseAdminLink(fields[SITE_SETTINGS_FIELDS.promoBarLink]);
  const message: PromoMessage = {
    text: truncateCodePoints(text, MAX_PROMO_TEXT_LENGTH).trim(),
    ...(link ? {to: link.href, external: link.external} : {}),
  };
  return message;
}

/**
 * The settings of the first entry, or none. Total: a missing entry, empty fields and junk values give
 * "nothing to show", never an error (NFR-013).
 */
export function mapSiteSettings(nodes: SettingsNodes): SiteSettings {
  const entry = nodes[0];
  if (!entry) return NO_SITE_SETTINGS;
  const fields = fieldRecord(entry.fields);
  const phone = fields[SITE_SETTINGS_FIELDS.supportPhone];
  return {
    promo: promoFrom(fields),
    supportPhoneRaw: phone === undefined ? null : phone,
  };
}

/**
 * The phone to show. A valid number in `PUBLIC_SUPPORT_PHONE` wins (the deployment's explicit override), then
 * the admin value, then nothing; only development falls back to the labelled placeholder (`resolveSupportPhone`
 * owns the US-number rules and the placeholder). An invalid override is ignored rather than hiding a valid
 * admin number.
 */
export function chooseSupportPhone(
  envValue: unknown,
  settings: SiteSettings,
  isDev: boolean,
): SupportPhone | null {
  return (
    resolveSupportPhone(envValue, false) ??
    resolveSupportPhone(settings.supportPhoneRaw, isDev)
  );
}

/**
 * Reads the settings. A failed read must not take any page down (the root loader runs for every request): the
 * bar and the admin phone are simply absent, and only the error's class name is logged (T-05).
 */
export async function loadSiteSettings(
  storefront: Storefront,
): Promise<SiteSettings> {
  try {
    const {settings} = await storefront.query(SITE_SETTINGS_QUERY, {
      cache: pricedCache(storefront),
    });
    return mapSiteSettings(settings.nodes);
  } catch (error: unknown) {
    logError('root.site_settings_read_failed', errorFields(error));
    return NO_SITE_SETTINGS;
  }
}
