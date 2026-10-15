// Offer rules and the delivery zone for the cart, parsed from untrusted JSON (P4-03, P4-04, P4-07, P4-09).
//
// SEAM, not the final source. SHOPIFY_DATA_MODEL says rules come from the `offer_rule`, `site_settings` and
// `delivery_zone` metaobjects, but their exact schema is still open (P3A-02 follow-up) and the development
// store does not exist yet. Until then the server reads one non-secret JSON setting, `OFFER_CONFIG_JSON`,
// and degrades to "no offers" when it is missing or invalid. Replacing this module's loader with a
// metaobject reader (P4-12) changes nothing downstream: both produce the same `OfferConfig`.
//
// Every value is checked here, because anything that names a variant ends up as a cart line: ids must be
// Shopify GIDs, counts are bounded integers, and a malformed rule is dropped (never half-applied).

import {isValidCents} from '~/lib/delivery/cents';
import {parseZoneList, type DeliveryZone} from '~/lib/delivery/zone';
import {
  EMPTY_OFFER_RULES,
  type AddOnRelation,
  type BundleMemberRule,
  type BundleRule,
  type ComfortGuaranteeRules,
  type FreeDeliveryRules,
  type GiftRule,
  type HaulAwayRules,
  type MatchingAddOnRules,
  type OfferRules,
} from '~/lib/offers/types';

export type OfferConfig = {
  readonly rules: OfferRules;
  /** null = no delivery zone known: haul-away fails closed (zone-unavailable). */
  readonly zone: DeliveryZone | null;
};

export const EMPTY_OFFER_CONFIG: OfferConfig = {
  rules: EMPTY_OFFER_RULES,
  zone: null,
};

export type OfferConfigLoad = {
  readonly status: 'none' | 'ok' | 'invalid';
  readonly config: OfferConfig;
  /** Short, value-free notes for the server log (which entry was dropped and why). */
  readonly warnings: readonly string[];
};

const MAX_CONFIG_LENGTH = 100_000;
const MAX_RULES = 50;
const MAX_LIST = 200;
const MAX_SIZES = 20;
const MAX_NAME = 120;
const MAX_QUANTITY = 99;

const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/[1-9]\d{0,19}$/;
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/[1-9]\d{0,19}$/;
const COLLECTION_GID = /^gid:\/\/shopify\/Collection\/[1-9]\d{0,19}$/;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value.slice(0, MAX_LIST) : [];
}

function gid(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

function name(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.length > MAX_NAME ? null : trimmed;
}

function boundedInt(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

function gids(value: unknown, pattern: RegExp): string[] | null {
  const ids: string[] = [];
  for (const entry of list(value)) {
    const id = gid(entry, pattern);
    if (id === null) return null;
    ids.push(id);
  }
  return ids;
}

/** Size -> variant id. One bad entry rejects the map: a half-known size table would offer the wrong size. */
function variantsBySize(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > MAX_SIZES) return null;
  const result: Record<string, string> = {};
  for (const [size, id] of entries) {
    const label = name(size);
    const variantId = gid(id, VARIANT_GID);
    if (label === null || variantId === null) return null;
    result[label] = variantId;
  }
  return result;
}

type Warn = (note: string) => void;

function parseGift(value: unknown): GiftRule | null {
  if (!isRecord(value)) return null;
  const id = name(value.id);
  const label = name(value.name);
  const products = gids(value.qualifyingProductIds ?? [], PRODUCT_GID);
  const collections = gids(value.qualifyingCollectionIds ?? [], COLLECTION_GID);
  const sizes = variantsBySize(value.giftVariantIdsBySize);
  const maxQuantity = boundedInt(value.maxQuantity, 1, MAX_QUANTITY);
  if (
    id === null ||
    label === null ||
    products === null ||
    collections === null ||
    sizes === null ||
    maxQuantity === null ||
    products.length + collections.length === 0
  ) {
    return null;
  }
  return {
    id,
    name: label,
    qualifyingProductIds: products,
    qualifyingCollectionIds: collections,
    giftVariantIdsBySize: sizes,
    maxQuantity,
  };
}

function parseBundleMember(value: unknown): BundleMemberRule | null {
  if (!isRecord(value) || !isRecord(value.variants)) return null;
  const productId = gid(value.productId, PRODUCT_GID);
  const quantity = boundedInt(value.quantity, 1, MAX_QUANTITY);
  if (productId === null || quantity === null) return null;
  if (value.variants.type === 'single') {
    const variantId = gid(value.variants.variantId, VARIANT_GID);
    return variantId === null
      ? null
      : {productId, quantity, variants: {type: 'single', variantId}};
  }
  if (value.variants.type === 'by-size') {
    const variantIdBySize = variantsBySize(value.variants.variantIdBySize);
    return variantIdBySize === null
      ? null
      : {productId, quantity, variants: {type: 'by-size', variantIdBySize}};
  }
  return null;
}

function parseBundle(value: unknown): BundleRule | null {
  if (!isRecord(value)) return null;
  const id = name(value.id);
  const label = name(value.name);
  const anchorProductId = gid(value.anchorProductId, PRODUCT_GID);
  const members: BundleMemberRule[] = [];
  for (const entry of list(value.members)) {
    const member = parseBundleMember(entry);
    if (member === null) return null;
    members.push(member);
  }
  if (
    id === null ||
    label === null ||
    anchorProductId === null ||
    members.length === 0
  ) {
    return null;
  }
  return {id, name: label, anchorProductId, members};
}

function parseComfort(value: unknown): ComfortGuaranteeRules | null {
  if (!isRecord(value)) return null;
  const products = gids(value.qualifyingProductIds, PRODUCT_GID);
  const sizes = variantsBySize(value.protectorVariantIdBySize);
  return products === null || products.length === 0 || sizes === null
    ? null
    : {qualifyingProductIds: products, protectorVariantIdBySize: sizes};
}

function parseRelation(value: unknown): AddOnRelation | null {
  if (!isRecord(value)) return null;
  const mattressProductId = gid(value.mattressProductId, PRODUCT_GID);
  const productId = gid(value.productId, PRODUCT_GID);
  const variantId = gid(value.variantId, VARIANT_GID);
  const size = value.size === null ? null : name(value.size);
  if (
    mattressProductId === null ||
    productId === null ||
    variantId === null ||
    (value.size !== null && size === null)
  ) {
    return null;
  }
  return {mattressProductId, size, productId, variantId};
}

function parseRelations(value: unknown, warn: Warn, key: string) {
  const relations: AddOnRelation[] = [];
  for (const entry of list(value)) {
    const relation = parseRelation(entry);
    if (relation === null) warn(`matchingAddOns.${key}: entry dropped`);
    else relations.push(relation);
  }
  return relations;
}

function parseAddOns(value: unknown, warn: Warn): MatchingAddOnRules {
  const source = isRecord(value) ? value : {};
  return {
    foundations: parseRelations(source.foundations, warn, 'foundations'),
    protectors: parseRelations(source.protectors, warn, 'protectors'),
    pillows: parseRelations(source.pillows, warn, 'pillows'),
    bedding: parseRelations(source.bedding, warn, 'bedding'),
  };
}

function parseHaulAway(value: unknown): HaulAwayRules | null {
  if (!isRecord(value)) return null;
  const variantId = gid(value.variantId, VARIANT_GID);
  const maxPieces = boundedInt(value.maxPieces, 1, MAX_QUANTITY);
  return variantId === null || maxPieces === null
    ? null
    : {variantId, maxPieces};
}

function parseFreeDelivery(value: unknown): FreeDeliveryRules | null {
  if (!isRecord(value)) return null;
  const thresholdCents = value.thresholdCents;
  // Zero would announce free delivery to everyone when the setting is simply empty (free-delivery.ts).
  return isValidCents(thresholdCents) && thresholdCents > 0
    ? {thresholdCents}
    : null;
}

function parseAll<T>(
  value: unknown,
  parse: (entry: unknown) => T | null,
  warn: Warn,
  label: string,
): T[] {
  const parsed: T[] = [];
  for (const entry of list(value).slice(0, MAX_RULES)) {
    const rule = parse(entry);
    if (rule === null) warn(`${label}: rule dropped`);
    else parsed.push(rule);
  }
  return parsed;
}

function parseRules(value: unknown, warn: Warn): OfferRules {
  if (!isRecord(value)) return EMPTY_OFFER_RULES;
  const comfortGuarantee =
    value.comfortGuarantee === undefined || value.comfortGuarantee === null
      ? null
      : parseComfort(value.comfortGuarantee);
  const haulAway =
    value.haulAway === undefined || value.haulAway === null
      ? null
      : parseHaulAway(value.haulAway);
  const freeDelivery =
    value.freeDelivery === undefined || value.freeDelivery === null
      ? null
      : parseFreeDelivery(value.freeDelivery);
  if (value.comfortGuarantee && comfortGuarantee === null) {
    warn('comfortGuarantee: switched off, invalid');
  }
  if (value.haulAway && haulAway === null) warn('haulAway: switched off');
  if (value.freeDelivery && freeDelivery === null) {
    warn('freeDelivery: switched off');
  }
  return {
    gifts: parseAll(value.gifts, parseGift, warn, 'gifts'),
    bundles: parseAll(value.bundles, parseBundle, warn, 'bundles'),
    comfortGuarantee,
    matchingAddOns: parseAddOns(value.matchingAddOns, warn),
    haulAway,
    freeDelivery,
  };
}

function parseZone(value: unknown, warn: Warn): DeliveryZone | null {
  if (!isRecord(value)) return null;
  const label = name(value.name);
  const promise = isRecord(value.promise) ? value.promise : {};
  const feeCents = value.feeCents;
  const freeOverCents = value.freeOverCents ?? null;
  const postalCodes =
    typeof value.postalCodes === 'string'
      ? parseZoneList(value.postalCodes).entries
      : [];
  if (
    label === null ||
    !isValidCents(feeCents) ||
    (freeOverCents !== null && !isValidCents(freeOverCents)) ||
    postalCodes.length === 0
  ) {
    warn('zone: ignored, invalid');
    return null;
  }
  const text = (key: string) =>
    typeof promise[key] === 'string' ? String(promise[key]).slice(0, 300) : '';
  return {
    name: label,
    postalCodes,
    feeCents,
    freeOverCents,
    promise: {
      inHome: text('inHome'),
      parcel: text('parcel'),
      pickup: text('pickup'),
    },
  };
}

/** Parses an already-decoded JSON value. Never throws. */
export function parseOfferConfig(raw: unknown): OfferConfigLoad {
  const warnings: string[] = [];
  const warn: Warn = (note) => warnings.push(note);
  if (!isRecord(raw)) {
    return {
      status: 'invalid',
      config: EMPTY_OFFER_CONFIG,
      warnings: ['config: not an object'],
    };
  }
  return {
    status: 'ok',
    config: {
      rules: parseRules(raw.rules, warn),
      zone: parseZone(raw.zone, warn),
    },
    warnings,
  };
}

/**
 * NOTE for the P4-12 reader that replaces this one: keep the three outcomes apart. "Offers off" is the
 * explicit OFFERS_ENABLED=false switch (server.ts). A missing, oversized or unreadable source is NOT "off":
 * in production it must leave the hand-off unavailable with a loud, value-free log, because without the
 * rules a gift, protector or service line looks like an ordinary line.
 *
 * Reads the setting from the request-context env (never `process.env`, ADR-0004). Missing = no offers;
 * unreadable = no offers plus a warning. The cart keeps working either way (NFR-013).
 */
export function readOfferConfig(env: object): OfferConfigLoad {
  // Reflect.get: the request-context Env is an interface with no index signature.
  const text: unknown = Reflect.get(env, 'OFFER_CONFIG_JSON');
  if (typeof text !== 'string' || text.trim() === '') {
    return {status: 'none', config: EMPTY_OFFER_CONFIG, warnings: []};
  }
  if (text.length > MAX_CONFIG_LENGTH) {
    return {
      status: 'invalid',
      config: EMPTY_OFFER_CONFIG,
      warnings: ['config: too large'],
    };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parseOfferConfig(parsed);
  } catch {
    return {
      status: 'invalid',
      config: EMPTY_OFFER_CONFIG,
      warnings: ['config: not valid JSON'],
    };
  }
}

/** True when a gift rule qualifies by collection, so the cart lines need their product's collection ids. */
export function rulesNeedCollections(rules: OfferRules): boolean {
  return rules.gifts.some((gift) => gift.qualifyingCollectionIds.length > 0);
}

/**
 * The offer rules for a cart the gate has already judged (server.ts `loadConfig` decided "off", "required" and
 * "unverified" before this is called): "offers off" and a missing or unreadable setting both read as no rules. Never
 * use it to decide whether a cart may be judged at all; that is the gate's decision, not this one's.
 */
export function offerRulesOf(env: object): OfferRules {
  if (Reflect.get(env, 'OFFERS_ENABLED') === 'false') return EMPTY_OFFER_RULES;
  return readOfferConfig(env).config.rules;
}
