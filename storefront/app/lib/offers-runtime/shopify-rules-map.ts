// Pure mapping from what Shopify's Admin API says (active automatic discounts, `offer_rule` and `delivery_zone`
// metaobjects, product variants) to the JSON shape `parseOfferConfig` validates. The server reads no offer environment
// variable: a gift exists because a Buy X get Y automatic discount exists, everything else because staff filled in a
// metaobject (ADR-0013). Nothing here does I/O, and the output still goes through the strict parser, so a malformed
// answer drops a rule instead of half-applying it.
//
// Input is untrusted data (T-15): every access narrows from `unknown`.

export type VariantInfo = {
  readonly id: string;
  readonly title: string;
  /** Value of the "Size" option, or null when the variant has none. */
  readonly size: string | null;
};

export type ProductInfo = {
  readonly id: string;
  readonly title: string;
  readonly variants: readonly VariantInfo[];
};

export type RawOfferConfig = {
  readonly rules: Record<string, unknown>;
  readonly zone: Record<string, unknown> | null;
};

type Json = Record<string, unknown>;
type Warn = (note: string) => void;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function items(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function nodesOf(connection: unknown): readonly unknown[] {
  return isRecord(connection) ? items(connection.nodes) : [];
}

function idOf(value: unknown): string | null {
  return isRecord(value) ? text(value.id) : null;
}

const DEFAULT_VARIANT_TITLE = 'Default Title';

/** The Size option of a variant, from the `selectedOptions` the Admin API returns. */
export function sizeOfOptions(selectedOptions: unknown): string | null {
  for (const option of items(selectedOptions)) {
    if (isRecord(option) && option.name === 'Size') return text(option.value);
  }
  return null;
}

/** Normalises one Admin `Product` node (with `variants`) so the mappers never touch raw shapes. */
export function productInfoOf(node: unknown): ProductInfo | null {
  if (!isRecord(node)) return null;
  const id = text(node.id);
  if (id === null) return null;
  const variants: VariantInfo[] = [];
  for (const variant of nodesOf(node.variants)) {
    if (!isRecord(variant)) continue;
    const variantId = text(variant.id);
    if (variantId === null) continue;
    variants.push({
      id: variantId,
      title: text(variant.title) ?? DEFAULT_VARIANT_TITLE,
      size: sizeOfOptions(variant.selectedOptions),
    });
  }
  return {id, title: text(node.title) ?? '', variants};
}

/** The key a gift picker shows for a variant: its size, else its title ("Default Title" reads as "Standard"). */
function giftKey(variant: VariantInfo): string {
  if (variant.size !== null) return variant.size;
  return variant.title === DEFAULT_VARIANT_TITLE ? 'Standard' : variant.title;
}

// ---------------------------------------------------------------------------------------------------
// Gifts: active automatic "Buy X get Y" discounts
// ---------------------------------------------------------------------------------------------------

function positiveInt(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d{1,6}$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function collectIds(
  itemsValue: unknown,
  products: Set<string>,
  collections: Set<string>,
): boolean {
  if (!isRecord(itemsValue)) return false;
  if (itemsValue.__typename === 'DiscountProducts') {
    for (const product of nodesOf(itemsValue.products)) {
      const id = idOf(product);
      if (id !== null) products.add(id);
    }
    for (const variant of nodesOf(itemsValue.productVariants)) {
      const id = isRecord(variant) ? idOf(variant.product) : null;
      if (id !== null) products.add(id);
    }
    return true;
  }
  if (itemsValue.__typename === 'DiscountCollections') {
    for (const collection of nodesOf(itemsValue.collections)) {
      const id = idOf(collection);
      if (id !== null) collections.add(id);
    }
    return true;
  }
  return false;
}

type ProductLookup = ReadonlyMap<string, ProductInfo>;

/** The gift product ids a discounts answer names, so the loader can fetch their variants (lean discount queries). */
export function giftProductIdsOf(...answers: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const answer of answers) {
    const nodes = isRecord(answer) ? nodesOf(answer.discountNodes) : [];
    for (const node of nodes) {
      const gets =
        isRecord(node) && isRecord(node.discount)
          ? node.discount.customerGets
          : null;
      const getItems = isRecord(gets) ? gets.items : null;
      if (!isRecord(getItems)) continue;
      for (const product of nodesOf(getItems.products)) {
        const id = idOf(product);
        if (id !== null) ids.add(id);
      }
    }
  }
  return [...ids];
}

/** The variants the "get" side hands out: the chosen variants when the discount names some, else all of each product. */
function giftVariants(itemsValue: unknown, lookup: ProductLookup): Json {
  const bySize: Json = {};
  if (!isRecord(itemsValue) || itemsValue.__typename !== 'DiscountProducts') {
    return bySize;
  }
  const chosen = nodesOf(itemsValue.productVariants).flatMap((variant) => {
    if (!isRecord(variant)) return [];
    const id = text(variant.id);
    return id === null
      ? []
      : [
          {
            productTitle: isRecord(variant.product)
              ? (text(variant.product.title) ?? '')
              : '',
            variant: {
              id,
              title: text(variant.title) ?? DEFAULT_VARIANT_TITLE,
              size: sizeOfOptions(variant.selectedOptions),
            } satisfies VariantInfo,
          },
        ];
  });
  const fromProducts = nodesOf(itemsValue.products).flatMap((node) => {
    // A product node that carries its own variants wins; a lean node is completed from the fetched products.
    const nodeId = idOf(node);
    const product =
      (nodeId === null ? undefined : lookup.get(nodeId)) ?? productInfoOf(node);
    return product === null
      ? []
      : product.variants.map((variant) => ({
          productTitle: product.title,
          variant,
        }));
  });
  const all = chosen.length > 0 ? chosen : fromProducts;
  // Two gift products can both have a "Queen": prefix the product title so one does not overwrite the other.
  const productTitles = new Set(all.map((entry) => entry.productTitle));
  for (const {productTitle, variant} of all) {
    const key =
      productTitles.size > 1 && productTitle !== ''
        ? `${productTitle} ${giftKey(variant)}`
        : giftKey(variant);
    bySize[key] = variant.id;
  }
  return bySize;
}

function giftFromDiscount(
  nodeId: string,
  discount: Json,
  lookup: ProductLookup,
  warn: Warn,
): Json | null {
  const title = text(discount.title) ?? 'Gift';
  const skip = (why: string): null => {
    warn(`gift discount skipped (${why})`);
    return null;
  };
  if (!isRecord(discount.customerBuys) || !isRecord(discount.customerGets)) {
    return skip('no buys or gets');
  }
  const buys = discount.customerBuys;
  const gets = discount.customerGets;

  // The engine qualifies a gift by the presence of one qualifying line, so a spend or multi-unit condition would offer
  // a gift Shopify then charges for. Better no offer than a blocked checkout.
  const buyValue = isRecord(buys.value) ? buys.value : {};
  if (
    buyValue.__typename !== 'DiscountQuantity' ||
    positiveInt(buyValue.quantity) !== 1
  ) {
    return skip('customer buys must be a minimum quantity of 1');
  }
  const products = new Set<string>();
  const collections = new Set<string>();
  if (!collectIds(buys.items, products, collections)) {
    return skip('customer buys must be specific products or collections');
  }
  if (products.size + collections.size === 0)
    return skip('no qualifying items');

  const getValue = isRecord(gets.value) ? gets.value : {};
  const effect = isRecord(getValue.effect) ? getValue.effect : {};
  const quantity = isRecord(getValue.quantity)
    ? positiveInt(getValue.quantity.quantity)
    : null;
  const percentage = effect.percentage;
  if (
    getValue.__typename !== 'DiscountOnQuantity' ||
    effect.__typename !== 'DiscountPercentage' ||
    typeof percentage !== 'number' ||
    percentage < 0.999 ||
    quantity === null
  ) {
    return skip('the gift must be 100% off a fixed quantity');
  }
  const sizes = giftVariants(gets.items, lookup);
  if (Object.keys(sizes).length === 0) return skip('no gift variants');

  // Shopify repeats a Buy X get Y for every set of buys unless "maximum uses per order" is set, so only the limited form
  // has a bound we can state; the cap is conservative (fewer gifts than Shopify would give, never more).
  const limit = positiveInt(discount.usesPerOrderLimit) ?? 1;
  return {
    id: nodeId,
    name: title,
    qualifyingProductIds: [...products],
    qualifyingCollectionIds: [...collections],
    giftVariantIdsBySize: sizes,
    maxQuantity: quantity * limit,
  };
}

/**
 * A plain "Amount off products" automatic discount that takes 100% off specific products makes those products gifts, offered
 * with any purchase (owner, 2026-11-06: "if a product is 100% off or free, it should show as a gift"). Any other amount-off
 * discount is an ordinary sale and is ignored without a warning. A minimum requirement cannot be judged by the engine, so
 * such a discount is skipped with a warning rather than offered and then charged.
 */
function freeProductGift(
  nodeId: string,
  discount: Json,
  lookup: ProductLookup,
  warn: Warn,
): Json | null {
  const gets = isRecord(discount.customerGets) ? discount.customerGets : {};
  const value = isRecord(gets.value) ? gets.value : {};
  const percentage = value.percentage;
  if (
    value.__typename !== 'DiscountPercentage' ||
    typeof percentage !== 'number' ||
    percentage < 0.999
  ) {
    return null;
  }
  const skip = (why: string): null => {
    warn(`free-product discount skipped (${why})`);
    return null;
  };
  if (!isRecord(gets.items) || gets.items.__typename !== 'DiscountProducts') {
    return skip('the free items must be specific products');
  }
  if (
    discount.minimumRequirement !== null &&
    discount.minimumRequirement !== undefined
  ) {
    return skip('a minimum requirement cannot be checked before checkout');
  }
  const sizes = giftVariants(gets.items, lookup);
  if (Object.keys(sizes).length === 0) return skip('no gift variants');
  // Shopify frees every unit of the product, so the only bound we can state is our own: one per order, which is never more
  // than Shopify discounts.
  return {
    id: nodeId,
    name: text(discount.title) ?? 'Free gift',
    anyPurchase: true,
    giftVariantIdsBySize: sizes,
    maxQuantity: 1,
  };
}

/** The discounts answers -> raw gift rules (Buy X get Y, and 100% off specific products). */
export function giftsFromDiscounts(
  data: unknown,
  warn: Warn,
  options: {readonly free?: unknown; readonly products?: ProductLookup} = {},
): Json[] {
  const lookup: ProductLookup =
    options.products ?? new Map<string, ProductInfo>();
  const gifts: Json[] = [];
  for (const node of isRecord(options.free)
    ? nodesOf(options.free.discountNodes)
    : []) {
    if (!isRecord(node) || !isRecord(node.discount)) continue;
    const id = text(node.id);
    if (
      id === null ||
      node.discount.__typename !== 'DiscountAutomaticBasic' ||
      node.discount.status !== 'ACTIVE'
    ) {
      continue;
    }
    const gift = freeProductGift(id, node.discount, lookup, warn);
    if (gift !== null) gifts.push(gift);
  }
  const nodes = isRecord(data) ? nodesOf(data.discountNodes) : [];
  for (const node of nodes) {
    if (!isRecord(node) || !isRecord(node.discount)) continue;
    const discount = node.discount;
    if (
      discount.__typename !== 'DiscountAutomaticBxgy' ||
      discount.status !== 'ACTIVE'
    ) {
      continue;
    }
    const id = text(node.id);
    if (id === null) continue;
    const gift = giftFromDiscount(id, discount, lookup, warn);
    if (gift !== null) gifts.push(gift);
  }
  return gifts;
}

// ---------------------------------------------------------------------------------------------------
// Everything else: `offer_rule` and `delivery_zone` metaobjects
// ---------------------------------------------------------------------------------------------------

type Fields = ReadonlyMap<string, string>;

function fieldsOf(node: unknown): Fields {
  const fields = new Map<string, string>();
  if (!isRecord(node)) return fields;
  for (const field of items(node.fields)) {
    if (!isRecord(field)) continue;
    const key = text(field.key);
    const value = typeof field.value === 'string' ? field.value : null;
    if (key !== null && value !== null && value.trim() !== '') {
      fields.set(key, value.trim());
    }
  }
  return fields;
}

/** Reference ids from a single reference ("gid://...") or a list reference (a JSON array of ids). */
function refIds(value: string | undefined): string[] {
  if (value === undefined) return [];
  if (value.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return items(parsed).flatMap((entry) => {
        const id = text(entry);
        return id === null ? [] : [id];
      });
    } catch {
      return [];
    }
  }
  return [value];
}

/** The product and collection ids a set of `offer_rule` nodes refers to, so the caller can fetch them once. */
export function referencedIds(ruleNodes: readonly unknown[]): {
  readonly offeredProductIds: string[];
  readonly triggerCollectionIds: string[];
} {
  const products = new Set<string>();
  const collections = new Set<string>();
  for (const node of ruleNodes) {
    const fields = fieldsOf(node);
    for (const id of refIds(fields.get('products'))) products.add(id);
    for (const id of refIds(fields.get('trigger_collection'))) {
      collections.add(id);
    }
  }
  return {
    offeredProductIds: [...products],
    triggerCollectionIds: [...collections],
  };
}

export type RuleLookups = {
  readonly products: ReadonlyMap<string, ProductInfo>;
  /** Collection id -> ids of the products in it. */
  readonly collections: ReadonlyMap<string, readonly string[]>;
};

type AddOnKey = 'foundations' | 'protectors' | 'pillows' | 'bedding';

function addOnKeyOf(type: string | undefined): AddOnKey | null {
  switch (type) {
    case 'foundation':
      return 'foundations';
    case 'matching_protector':
      return 'protectors';
    case 'pillow':
      return 'pillows';
    case 'bedding':
      return 'bedding';
    default:
      return null;
  }
}

function tail(gid: string): string {
  return gid.split('/').pop() ?? gid;
}

function sizeMap(product: ProductInfo): Json | null {
  const entries = product.variants.filter((variant) => variant.size !== null);
  if (entries.length === 0) return null;
  const bySize: Json = {};
  for (const variant of entries) {
    if (variant.size !== null) bySize[variant.size] = variant.id;
  }
  return bySize;
}

/** A product with Size variants fits per size; a single-variant product fits every size. Anything else is ambiguous. */
function relationVariants(
  product: ProductInfo,
): ReadonlyArray<{size: string | null; variantId: string}> | null {
  const sized = product.variants.flatMap((variant) =>
    variant.size === null ? [] : [{size: variant.size, variantId: variant.id}],
  );
  if (sized.length > 0) return sized;
  const [only] = product.variants;
  return product.variants.length === 1 && only !== undefined
    ? [{size: null, variantId: only.id}]
    : null;
}

function bundleMember(product: ProductInfo): Json | null {
  const bySize = sizeMap(product);
  if (bySize !== null) {
    return {
      productId: product.id,
      quantity: 1,
      variants: {type: 'by-size', variantIdBySize: bySize},
    };
  }
  const [only] = product.variants;
  return product.variants.length === 1 && only !== undefined
    ? {
        productId: product.id,
        quantity: 1,
        variants: {type: 'single', variantId: only.id},
      }
    : null;
}

/** "149.00" or a money JSON ({"amount":"149.0","currency_code":"USD"}) -> cents, or null. No float arithmetic. */
export function centsOfMoney(value: string | undefined): number | null {
  if (value === undefined) return null;
  let amount: unknown = value;
  if (value.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(value);
      amount = isRecord(parsed) ? parsed.amount : null;
    } catch {
      return null;
    }
  }
  if (typeof amount !== 'string') return null;
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (match === null) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

type Accumulator = {
  bundles: Json[];
  comfort: Json | null;
  haulAway: Json | null;
  addOns: Record<AddOnKey, Json[]>;
};

function applyRule(
  node: unknown,
  lookups: RuleLookups,
  acc: Accumulator,
  warn: Warn,
): void {
  const fields = fieldsOf(node);
  const type = fields.get('type');
  const name = fields.get('name') ?? 'unnamed rule';
  if (fields.get('enabled') === 'false') return;

  const triggers = [
    ...new Set([
      ...refIds(fields.get('trigger_product')),
      ...refIds(fields.get('trigger_collection')).flatMap(
        (id) => lookups.collections.get(id) ?? [],
      ),
    ]),
  ];
  const offered = refIds(fields.get('products')).flatMap((id) => {
    const product = lookups.products.get(id);
    return product === undefined ? [] : [product];
  });
  const skip = (why: string) => warn(`offer rule "${name}" skipped (${why})`);

  if (type === 'comfort_protector') {
    const sizes = offered[0] === undefined ? null : sizeMap(offered[0]);
    if (triggers.length === 0 || sizes === null) {
      return skip('needs a trigger and a protector product with sizes');
    }
    if (acc.comfort !== null) return skip('only one comfort rule is used');
    acc.comfort = {
      qualifyingProductIds: triggers,
      protectorVariantIdBySize: sizes,
    };
    return;
  }

  if (type === 'haul_away') {
    const variant = offered[0]?.variants[0];
    const maxPieces = positiveInt(Number(fields.get('max_quantity')));
    if (variant === undefined || maxPieces === null) {
      return skip('needs a service product and a maximum quantity');
    }
    if (acc.haulAway !== null) return skip('only one haul-away rule is used');
    acc.haulAway = {variantId: variant.id, maxPieces};
    return;
  }

  if (type === 'bundle') {
    if (triggers.length === 0 || offered.length === 0) {
      return skip('needs an anchor product and offered products');
    }
    const discountTitle = fields.get('discount_title');
    for (const anchor of triggers) {
      const members = offered
        .filter((product) => product.id !== anchor)
        .map(bundleMember);
      if (members.length === 0 || members.some((member) => member === null)) {
        skip('a product has no usable variants');
        continue;
      }
      acc.bundles.push({
        id: `bundle-${tail(text(isRecord(node) ? node.id : null) ?? name)}-${tail(anchor)}`,
        name,
        anchorProductId: anchor,
        members,
        ...(discountTitle === undefined ? {} : {discountTitle}),
      });
    }
    return;
  }

  const key = addOnKeyOf(type);
  if (key !== null) {
    if (triggers.length === 0 || offered.length === 0) {
      return skip('needs a trigger and offered products');
    }
    for (const product of offered) {
      const variants = relationVariants(product);
      if (variants === null) {
        skip(`product ${tail(product.id)} has no Size variants`);
        continue;
      }
      for (const mattressProductId of triggers) {
        for (const {size, variantId} of variants) {
          acc.addOns[key].push({
            mattressProductId,
            size,
            productId: product.id,
            variantId,
          });
        }
      }
    }
    return;
  }

  if (type === 'gift') {
    warn(`offer rule "${name}" ignored: gifts come from automatic discounts`);
    return;
  }
  skip('unknown type');
}

export function zoneFromMetaobject(node: unknown, warn: Warn): Json | null {
  const fields = fieldsOf(node);
  const name = fields.get('name');
  const postalCodes = fields.get('postal_codes');
  const feeCents = centsOfMoney(fields.get('fee'));
  if (name === undefined || postalCodes === undefined || feeCents === null) {
    warn('delivery zone ignored: needs a name, postal codes and a fee');
    return null;
  }
  const freeOverCents = centsOfMoney(fields.get('free_over'));
  return {
    name,
    postalCodes,
    feeCents,
    freeOverCents,
    promise: {
      inHome: fields.get('promise_white_glove') ?? '',
      parcel: fields.get('promise_parcel') ?? '',
      pickup: fields.get('promise_pickup') ?? '',
    },
  };
}

/** Builds the raw configuration `parseOfferConfig` validates. */
export function buildRawOfferConfig(input: {
  readonly gifts: readonly Json[];
  readonly ruleNodes: readonly unknown[];
  readonly zoneNode: unknown;
  readonly lookups: RuleLookups;
  readonly warn: Warn;
}): RawOfferConfig {
  const acc: Accumulator = {
    bundles: [],
    comfort: null,
    haulAway: null,
    addOns: {foundations: [], protectors: [], pillows: [], bedding: []},
  };
  for (const node of input.ruleNodes) {
    applyRule(node, input.lookups, acc, input.warn);
  }
  const zone =
    input.zoneNode === undefined || input.zoneNode === null
      ? null
      : zoneFromMetaobject(input.zoneNode, input.warn);
  // The zone's single free-over amount is also the cart's free-delivery message (one source, data model).
  const freeOver =
    zone === null || typeof zone.freeOverCents !== 'number'
      ? null
      : zone.freeOverCents;
  return {
    rules: {
      gifts: input.gifts,
      bundles: acc.bundles,
      comfortGuarantee: acc.comfort,
      matchingAddOns: acc.addOns,
      haulAway: acc.haulAway,
      freeDelivery:
        freeOver !== null && freeOver > 0 ? {thresholdCents: freeOver} : null,
    },
    zone,
  };
}
