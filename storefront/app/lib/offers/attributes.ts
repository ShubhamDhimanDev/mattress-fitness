// Cart attributes that record declined offers and the delivery choice (REQ-PRE-005, ADR-0003, ADR-0006).
// Cart attributes become order note attributes in Shopify admin, so customer service sees what was declined.
// The names below are a contract with that admin view and with the Flow/webhook checks in Phase 5B:
// change them only with a migration note in the admin guide.
//
// Shoppers can write any cart attribute through Shopify's public Storefront API, so the parser accepts only
// these exact keys and values and ignores everything else.
//
// Not verified (record at P4-10): whether cartAttributesUpdate replaces or merges the attribute list. The
// builders therefore always write an explicit value ('yes' or 'no') and never rely on a key being absent.

import type {DeclinableOffer, DeliveryChoice} from './types';

export const DELIVERY_CHOICE_ATTRIBUTE = 'delivery_choice';

export const DECLINE_ATTRIBUTE_KEYS = {
  'comfort-guarantee': 'offer_declined_comfort_guarantee',
  'haul-away': 'offer_declined_haul_away',
  'accident-protection': 'offer_declined_protection',
} as const satisfies Record<DeclinableOffer, string>;

export const DECLINED_VALUE = 'yes';
export const NOT_DECLINED_VALUE = 'no';

const DECLINABLE_OFFERS = [
  'comfort-guarantee',
  'haul-away',
  'accident-protection',
] as const satisfies readonly DeclinableOffer[];

/** The shape of Shopify's `AttributeInput` for cartAttributesUpdate. */
export type CartAttributeInput = {key: string; value: string};

export type OfferAttributeState = {
  readonly deliveryChoice: DeliveryChoice | null;
  readonly declined: Readonly<Record<DeclinableOffer, boolean>>;
};

/** Validates an offer id coming from a form field or URL before it is used to pick an attribute. */
export function parseDeclinableOffer(value: unknown): DeclinableOffer | null {
  return DECLINABLE_OFFERS.find((offer) => offer === value) ?? null;
}

export function parseDeliveryChoice(value: unknown): DeliveryChoice | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'in-home' || normalized === 'pickup'
    ? normalized
    : null;
}

export function declineAttribute(offer: DeclinableOffer): CartAttributeInput {
  return {key: DECLINE_ATTRIBUTE_KEYS[offer], value: DECLINED_VALUE};
}

/** Written when a shopper who declined goes back and accepts, so the order no longer shows a decline. */
export function clearDeclineAttribute(
  offer: DeclinableOffer,
): CartAttributeInput {
  return {key: DECLINE_ATTRIBUTE_KEYS[offer], value: NOT_DECLINED_VALUE};
}

export function clearAllDeclineAttributes(): CartAttributeInput[] {
  return DECLINABLE_OFFERS.map(clearDeclineAttribute);
}

export function deliveryChoiceAttribute(
  choice: DeliveryChoice,
): CartAttributeInput {
  return {key: DELIVERY_CHOICE_ATTRIBUTE, value: choice};
}

/** True for the keys this module owns; lets an action refuse to forward a shopper-chosen attribute key. */
export function isOfferAttributeKey(key: unknown): boolean {
  return (
    key === DELIVERY_CHOICE_ATTRIBUTE ||
    DECLINABLE_OFFERS.some((offer) => DECLINE_ATTRIBUTE_KEYS[offer] === key)
  );
}

// Accepts the Storefront API list shape ([{key, value}]), a plain record, or junk. Later duplicates win.
function readAttributes(source: unknown): Map<string, string> {
  const attributes = new Map<string, string>();
  if (Array.isArray(source)) {
    const items: readonly unknown[] = source;
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      if (!('key' in item) || !('value' in item)) continue;
      const {key, value} = item;
      if (typeof key === 'string' && typeof value === 'string') {
        attributes.set(key, value);
      }
    }
    return attributes;
  }
  if (typeof source === 'object' && source !== null) {
    for (const [key, value] of Object.entries(source)) {
      const candidate: unknown = value;
      if (typeof candidate === 'string') attributes.set(key, candidate);
    }
  }
  return attributes;
}

/**
 * Reads the offer attributes from a cart. Unknown keys, unexpected values, wrong types and null input
 * are ignored: an unreadable decline means "not declined", an unreadable choice means "not chosen".
 */
export function parseOfferAttributes(source: unknown): OfferAttributeState {
  const attributes = readAttributes(source);
  const isDeclined = (offer: DeclinableOffer): boolean =>
    attributes.get(DECLINE_ATTRIBUTE_KEYS[offer])?.trim().toLowerCase() ===
    DECLINED_VALUE;
  return {
    deliveryChoice: parseDeliveryChoice(
      attributes.get(DELIVERY_CHOICE_ATTRIBUTE),
    ),
    declined: {
      'comfort-guarantee': isDeclined('comfort-guarantee'),
      'haul-away': isDeclined('haul-away'),
      'accident-protection': isDeclined('accident-protection'),
    },
  };
}
