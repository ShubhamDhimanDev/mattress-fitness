import {describe, expect, it} from 'vitest';
import {isInZone, parseZoneList} from '~/lib/delivery/zone';
import {readOfferConfig} from '~/lib/offers-runtime/config';
import type {AddOnRelation, OfferRules} from '~/lib/offers/types';
import {
  decodeProduct,
  decodeVariant,
  HAUL_HANDLE,
  loadExampleConfig,
  loadSampleCatalog,
  minifiedExampleConfig,
  readExampleConfigText,
  relatedHandlesOfMattressSheet,
  SIZES,
} from './sample-config-support';

// P4-12 interim (DEC-082): the PLACEHOLDER example offer configuration, the made-up sample catalog and the real config
// parser must agree. Nothing here talks to a store; every id in the example is a fake placeholder. REQ-CAT-007,
// REQ-CAT-008, REQ-CART-002, REQ-PROMO-001, REQ-PROMO-002, REQ-PRE-003, REQ-DEL-001.

const catalog = loadSampleCatalog();
const loaded = loadExampleConfig();
const {rules, zone} = loaded.config;

/** Handle and size a placeholder variant id stands for; fails the test when the id is not one of ours. */
function variantOf(id: string) {
  const decoded = decodeVariant(id);
  expect(decoded, `${id} is not a placeholder variant id`).not.toBeNull();
  if (decoded === null) throw new Error('unreachable');
  return decoded;
}

function productOf(id: string) {
  const handle = decodeProduct(id);
  expect(handle, `${id} is not a placeholder product id`).not.toBeNull();
  if (handle === null) throw new Error('unreachable');
  return handle;
}

/** Every variant id that appears anywhere in the rules. */
function allVariantIds(offer: OfferRules): string[] {
  const relationIds = (relations: readonly AddOnRelation[]) =>
    relations.map((relation) => relation.variantId);
  return [
    ...offer.gifts.flatMap((gift) => Object.values(gift.giftVariantIdsBySize)),
    ...offer.bundles.flatMap((bundle) =>
      bundle.members.flatMap((member) =>
        member.variants.type === 'single'
          ? [member.variants.variantId]
          : Object.values(member.variants.variantIdBySize),
      ),
    ),
    ...Object.values(offer.comfortGuarantee?.protectorVariantIdBySize ?? {}),
    ...relationIds(offer.matchingAddOns.foundations),
    ...relationIds(offer.matchingAddOns.protectors),
    ...relationIds(offer.matchingAddOns.pillows),
    ...relationIds(offer.matchingAddOns.bedding),
    ...(offer.haulAway ? [offer.haulAway.variantId] : []),
  ];
}

describe('the example offer configuration goes through the real parser (P4-12)', () => {
  it('parses with status ok and no dropped entry', () => {
    expect(loaded.status).toBe('ok');
    expect(loaded.warnings).toEqual([]);
  });

  it('reads the same way from the env setting: one line, within the size limit', () => {
    const line = minifiedExampleConfig();
    expect(line).not.toContain('\n');
    expect(line.length).toBeLessThan(100_000);
    const fromEnv = readOfferConfig({OFFER_CONFIG_JSON: line});
    expect(fromEnv.status).toBe('ok');
    expect(fromEnv.warnings).toEqual([]);
    expect(fromEnv.config).toEqual(loaded.config);
  });

  it('carries every rule kind the checklist needs', () => {
    expect(rules.gifts).toHaveLength(1);
    expect(rules.bundles).toHaveLength(3);
    expect(rules.comfortGuarantee).not.toBeNull();
    expect(rules.matchingAddOns.foundations.length).toBeGreaterThan(0);
    expect(rules.matchingAddOns.pillows.length).toBeGreaterThan(0);
    expect(rules.matchingAddOns.bedding.length).toBeGreaterThan(0);
    expect(rules.haulAway).toEqual({
      variantId: expect.stringMatching(/^gid:\/\/shopify\/ProductVariant\//),
      maxPieces: 2,
    });
    expect(rules.freeDelivery).toEqual({thresholdCents: 99900});
    expect(zone).not.toBeNull();
  });

  it('is clearly marked as a placeholder in the file and in every promotion name and title the shopper could see', () => {
    const raw: unknown = JSON.parse(readExampleConfigText());
    const marker =
      typeof raw === 'object' && raw !== null
        ? Reflect.get(raw, '_placeholder')
        : undefined;
    expect(typeof marker).toBe('string');
    expect(String(marker)).toMatch(/PLACEHOLDER/);
    expect(String(marker)).toMatch(/DEC-082/);
    for (const gift of rules.gifts) expect(gift.name).toMatch(/placeholder/i);
    for (const bundle of rules.bundles) {
      expect(bundle.name).toMatch(/placeholder/i);
      expect(bundle.discountTitle ?? '').toMatch(/placeholder/i);
    }
    expect(zone?.name).toMatch(/placeholder/i);
    for (const text of Object.values(zone?.promise ?? {})) {
      expect(text).toMatch(/placeholder/i);
    }
  });
});

describe('the example configuration agrees with the sample catalog sheets (REQ-CAT-007)', () => {
  it('every id is a placeholder id of a real sheet row: handle exists and has a variant of that size', () => {
    const haulVariant = rules.haulAway?.variantId;
    for (const id of allVariantIds(rules)) {
      const {handle, size} = variantOf(id);
      if (id === haulVariant) {
        // Created by hand in admin: a sheet row needs a Size, but the service has one default variant.
        expect(handle).toBe(HAUL_HANDLE);
        expect(catalog.has(HAUL_HANDLE)).toBe(false);
        continue;
      }
      const product = catalog.get(handle);
      expect(product, `${handle} is not in the sample sheets`).toBeDefined();
      expect(
        product?.variants.some((variant) => variant.size === size),
        `${handle} has no ${size} row`,
      ).toBe(true);
    }
  });

  it('keys by size name the size of the variant they point at', () => {
    const named: Record<string, string>[] = [
      ...rules.gifts.map((gift) => gift.giftVariantIdsBySize),
      ...(rules.comfortGuarantee
        ? [rules.comfortGuarantee.protectorVariantIdBySize]
        : []),
      ...rules.bundles.flatMap((bundle) =>
        bundle.members.flatMap((member) =>
          member.variants.type === 'by-size'
            ? [{...member.variants.variantIdBySize}]
            : [],
        ),
      ),
    ];
    for (const bySize of named) {
      for (const [label, id] of Object.entries(bySize)) {
        expect(variantOf(id).size).toBe(label);
      }
    }
    const sized: readonly AddOnRelation[] = [
      ...rules.matchingAddOns.foundations,
      ...rules.matchingAddOns.bedding,
    ];
    for (const relation of sized) {
      expect(variantOf(relation.variantId).size).toBe(relation.size);
      expect(productOf(relation.productId)).toBe(
        variantOf(relation.variantId).handle,
      );
    }
  });

  it('product ids and variant ids of one rule name the same product', () => {
    for (const relation of [
      ...rules.matchingAddOns.foundations,
      ...rules.matchingAddOns.pillows,
      ...rules.matchingAddOns.bedding,
    ]) {
      expect(productOf(relation.productId)).toBe(
        variantOf(relation.variantId).handle,
      );
      expect(catalog.has(productOf(relation.mattressProductId))).toBe(true);
    }
    for (const bundle of rules.bundles) {
      expect(catalog.get(productOf(bundle.anchorProductId))?.productType).toBe(
        'Mattress',
      );
      for (const member of bundle.members) {
        const ids =
          member.variants.type === 'single'
            ? [member.variants.variantId]
            : Object.values(member.variants.variantIdBySize);
        for (const id of ids) {
          expect(variantOf(id).handle).toBe(productOf(member.productId));
        }
      }
    }
  });

  it('gives a foundation and a sheet set for every size of every configured mattress, and nothing for a size the mattress lacks', () => {
    const mattressHandles = new Set(
      rules.bundles.map((bundle) => productOf(bundle.anchorProductId)),
    );
    for (const handle of mattressHandles) {
      const sizes = catalog.get(handle)?.variants.map((v) => v.size) ?? [];
      for (const relations of [
        rules.matchingAddOns.foundations,
        rules.matchingAddOns.bedding,
      ]) {
        const offered = relations
          .filter(
            (relation) => productOf(relation.mattressProductId) === handle,
          )
          .map((relation) => relation.size);
        expect([...offered].sort()).toEqual([...sizes].sort());
      }
    }
  });

  it('the related handles the older mattress sheet names exist in the offer sheet, so the import can link them', () => {
    for (const handle of relatedHandlesOfMattressSheet()) {
      expect(
        catalog.has(handle),
        `${handle} is not in offer-products.csv`,
      ).toBe(true);
    }
  });

  it('keeps the service, gift and protector variants apart from the products sold normally', () => {
    const giftIds = new Set(
      rules.gifts.flatMap((gift) => Object.values(gift.giftVariantIdsBySize)),
    );
    const protectorIds = new Set(
      Object.values(rules.comfortGuarantee?.protectorVariantIdBySize ?? {}),
    );
    const sold = new Set<string>([
      ...rules.matchingAddOns.foundations.map((r) => r.variantId),
      ...rules.matchingAddOns.pillows.map((r) => r.variantId),
      ...rules.matchingAddOns.bedding.map((r) => r.variantId),
      ...rules.bundles.flatMap((bundle) =>
        bundle.members.flatMap((member) =>
          member.variants.type === 'single' ? [member.variants.variantId] : [],
        ),
      ),
    ]);
    for (const id of giftIds) {
      expect(protectorIds.has(id)).toBe(false);
      expect(sold.has(id)).toBe(false);
      expect(rules.haulAway?.variantId).not.toBe(id);
    }
    for (const id of protectorIds) expect(sold.has(id)).toBe(false);
    expect(giftIds.has(rules.haulAway?.variantId ?? '')).toBe(false);
  });
});

describe('the placeholder gift rule matches DEC-082 (REQ-CART-002, REQ-PROMO-001)', () => {
  const gift = rules.gifts[0];

  it('qualifies only mattresses sold in queen or larger, every size above $999 at the price a shopper pays', () => {
    const queen = SIZES.indexOf('Queen');
    expect(gift).toBeDefined();
    for (const id of gift?.qualifyingProductIds ?? []) {
      const product = catalog.get(productOf(id));
      expect(product?.productType).toBe('Mattress');
      expect(product?.variants.length).toBeGreaterThan(0);
      for (const variant of product?.variants ?? []) {
        const position = SIZES.findIndex((size) => size === variant.size);
        expect(
          position,
          `${product?.handle} ${variant.size}`,
        ).toBeGreaterThanOrEqual(queen);
        expect(variant.payableCents).toBeGreaterThan(99_900);
        expect(variant.priceCents).toBeGreaterThan(99_900);
      }
    }
  });

  it('is a choice of one pillow, one per order, from a gift product that is not the pillow sold normally', () => {
    expect(gift?.maxQuantity).toBe(1);
    const choices = Object.values(gift?.giftVariantIdsBySize ?? {});
    expect(choices.length).toBeGreaterThanOrEqual(2);
    for (const id of choices) {
      const {handle} = variantOf(id);
      expect(handle).toBe('sample-gift-pillow');
      expect(catalog.get(handle)?.productType).toBe('Pillow');
    }
  });

  it('documents the limit: a product that mixes small and large sizes cannot qualify, because the discount and the rule choose products, not variants', () => {
    // Shopify "Buy X get Y" selects products or collections, never variants (help.shopify.com, checked 2026-10-23), and
    // the engine's gift rule qualifies by product or collection. So "queen or larger" only holds for products that have
    // no smaller size. cloudmere-hybrid (Twin at $999 up to Split California King) must therefore NOT be listed.
    const qualifying = new Set(
      (gift?.qualifyingProductIds ?? []).map(productOf),
    );
    expect(qualifying.has('cloudmere-hybrid')).toBe(false);
    expect(
      catalog
        .get('cloudmere-hybrid')
        ?.variants.some((variant) => variant.size === 'Twin'),
    ).toBe(true);
  });
});

describe('the placeholder sleep-set bundle matches DEC-082 (REQ-ADD-002, REQ-PROMO-002)', () => {
  it('is mattress + protector + pillow, all three bundles share one discount title, and a Twin has its own protector', () => {
    const titles = new Set(rules.bundles.map((bundle) => bundle.discountTitle));
    expect(titles.size).toBe(1);
    expect([...titles][0]).toBe('Sleep set 10% off (placeholder)');
    for (const bundle of rules.bundles) {
      expect(bundle.members.map((m) => productOf(m.productId))).toEqual([
        'sample-protector',
        'sample-pillow',
      ]);
      const protector = bundle.members[0]?.variants;
      expect(protector?.type).toBe('by-size');
      expect(
        Object.keys(
          protector?.type === 'by-size' ? protector.variantIdBySize : {},
        ),
      ).toEqual([...SIZES]);
    }
  });

  it('every bundle anchor also triggers the comfort guarantee, so the bundle protector is never removed as an orphan', () => {
    const comfort = new Set(rules.comfortGuarantee?.qualifyingProductIds);
    for (const bundle of rules.bundles) {
      expect(comfort.has(bundle.anchorProductId)).toBe(true);
    }
  });
});

describe('the placeholder delivery zone and free-delivery numbers (REQ-DEL-001, REQ-CART-004)', () => {
  it('has a clean ZIP list that the cart parser and the zone check read the same way', () => {
    expect(zone).not.toBeNull();
    if (zone === null) return;
    const parsed = parseZoneList(zone.postalCodes.join(', '));
    expect(parsed.warnings).toEqual([]);
    expect(isInZone(zone, '60645')).toBe(true);
    expect(isInZone(zone, '90210')).toBe(false);
  });

  it('keeps the zone free-over amount equal to the free-delivery threshold (they must match the Local delivery rule)', () => {
    expect(zone?.freeOverCents).toBe(rules.freeDelivery?.thresholdCents);
    expect(zone?.feeCents).toBeGreaterThan(0);
  });
});
