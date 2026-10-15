import {describe, expect, it} from 'vitest';
import type {CatalogProductQuery} from 'storefrontapi.generated';
import productJson from '../../fixtures/shopify/product.json';
import {recorded} from '../catalog/recorded';
import {FIXTURE_BRANDS} from '~/lib/shopify/brand-fixtures';
import {buildBrandJsonLd} from '~/lib/shopify/brand-data';
import {
  buildBreadcrumbJsonLd,
  buildFaqJsonLd,
  buildProductJsonLd,
} from '~/lib/shopify/jsonld';
import {mapProductPage} from '~/lib/shopify/product';
import type {ProductPageView} from '~/lib/shopify/types';
import {FIXTURE_STORES, getFixtureStore} from '~/lib/stores/fixtures';
import {buildStoreJsonLd, serializeJsonLd} from '~/lib/stores/jsonld';

// REQ-SEO-001, REQ-PDP-002, REQ-COL-004, REQ-LOC-001 (P7-04): the structured data the storefront emits, checked
// against the schema.org and Google rich-result requirements for each type, on recorded and fixture data.
// The validators below are test-only: they encode what each type must contain, so a builder change that drops
// a required field fails here. No rating, review or price is ever invented.

type Json = Record<string, unknown>;
const ORIGIN = 'https://www.example.com';
const SCHEMA_AVAILABILITY = [
  'https://schema.org/InStock',
  'https://schema.org/OutOfStock',
  'https://schema.org/PreOrder',
  'https://schema.org/BackOrder',
  'https://schema.org/SoldOut',
  'https://schema.org/LimitedAvailability',
];
const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';
const absoluteHttps = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};
const price = (value: unknown): boolean =>
  typeof value === 'string' && /^\d+\.\d{2}$/.test(value);

function offerProblems(offer: unknown): string[] {
  if (!isJson(offer)) return ['offer is not an object'];
  const problems: string[] = [];
  if (offer['@type'] !== 'Offer') problems.push('offer @type');
  if (!price(offer.price)) problems.push('offer price');
  if (!/^[A-Z]{3}$/.test(String(offer.priceCurrency)))
    problems.push('offer priceCurrency');
  if (!SCHEMA_AVAILABILITY.includes(String(offer.availability)))
    problems.push('offer availability');
  if (!absoluteHttps(offer.url)) problems.push('offer url');
  return problems;
}

/** Product: name, and offers that carry a price and a currency (Google merchant listing minimum). */
function productProblems(ld: Json): string[] {
  const problems: string[] = [];
  if (ld['@context'] !== 'https://schema.org') problems.push('@context');
  if (ld['@type'] !== 'Product') problems.push('@type');
  if (!text(ld.name)) problems.push('name');
  if (!absoluteHttps(ld.url)) problems.push('url');
  if ('description' in ld && !text(ld.description))
    problems.push('description');
  if ('image' in ld) {
    const images = ld.image;
    if (
      !Array.isArray(images) ||
      images.length === 0 ||
      !images.every(absoluteHttps)
    )
      problems.push('image');
  }
  if ('brand' in ld) {
    const brand = ld.brand;
    if (!isJson(brand) || brand['@type'] !== 'Brand' || !text(brand.name))
      problems.push('brand');
  }
  const offers = ld.offers;
  if (offers === undefined) return problems;
  if (!isJson(offers)) return [...problems, 'offers'];
  if (offers['@type'] === 'AggregateOffer') {
    const nested = Array.isArray(offers.offers) ? offers.offers : [];
    if (!price(offers.lowPrice) || !price(offers.highPrice))
      problems.push('aggregate prices');
    else if (Number(offers.lowPrice) > Number(offers.highPrice))
      problems.push('lowPrice above highPrice');
    if (offers.offerCount !== nested.length) problems.push('offerCount');
    if (!/^[A-Z]{3}$/.test(String(offers.priceCurrency)))
      problems.push('aggregate currency');
    for (const offer of nested) problems.push(...offerProblems(offer));
  } else {
    problems.push(...offerProblems(offers));
  }
  return problems;
}

function breadcrumbProblems(ld: Json): string[] {
  const problems: string[] = [];
  if (ld['@type'] !== 'BreadcrumbList') problems.push('@type');
  const items = Array.isArray(ld.itemListElement) ? ld.itemListElement : [];
  if (items.length === 0) problems.push('no items');
  items.forEach((item, index) => {
    if (!isJson(item)) return problems.push(`item ${index}`);
    if (item['@type'] !== 'ListItem') problems.push(`item ${index} @type`);
    if (item.position !== index + 1) problems.push(`item ${index} position`);
    if (!text(item.name)) problems.push(`item ${index} name`);
    if (!absoluteHttps(item.item)) problems.push(`item ${index} url`);
  });
  return problems;
}

function faqProblems(ld: Json): string[] {
  const problems: string[] = [];
  if (ld['@type'] !== 'FAQPage') problems.push('@type');
  const questions = Array.isArray(ld.mainEntity) ? ld.mainEntity : [];
  if (questions.length === 0) problems.push('no questions');
  questions.forEach((question, index) => {
    if (!isJson(question) || question['@type'] !== 'Question')
      return problems.push(`question ${index}`);
    if (!text(question.name)) problems.push(`question ${index} name`);
    const answer = question.acceptedAnswer;
    if (!isJson(answer) || answer['@type'] !== 'Answer' || !text(answer.text))
      problems.push(`question ${index} answer`);
  });
  return problems;
}

function localBusinessProblems(ld: Json): string[] {
  const problems: string[] = [];
  if (ld['@context'] !== 'https://schema.org') problems.push('@context');
  if (ld['@type'] !== 'LocalBusiness') problems.push('@type');
  if (!text(ld.name)) problems.push('name');
  const address = ld.address;
  if (!isJson(address) || address['@type'] !== 'PostalAddress') {
    problems.push('address');
  } else {
    for (const field of [
      'streetAddress',
      'addressLocality',
      'addressRegion',
      'postalCode',
    ]) {
      if (!text(address[field])) problems.push(`address ${field}`);
    }
    if (address.addressCountry !== 'US') problems.push('addressCountry');
  }
  if ('telephone' in ld && !/^\+\d{10,15}$/.test(String(ld.telephone)))
    problems.push('telephone');
  if ('image' in ld && !absoluteHttps(ld.image)) problems.push('image');
  if ('url' in ld && !absoluteHttps(ld.url)) problems.push('url');
  if ('geo' in ld) {
    const geo = ld.geo;
    const lat = isJson(geo) ? geo.latitude : null;
    const lon = isJson(geo) ? geo.longitude : null;
    if (
      typeof lat !== 'number' ||
      typeof lon !== 'number' ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    )
      problems.push('geo');
  }
  if ('openingHoursSpecification' in ld) {
    const specs = ld.openingHoursSpecification;
    if (!Array.isArray(specs) || specs.length === 0) problems.push('hours');
    else
      for (const spec of specs) {
        if (!isJson(spec) || spec['@type'] !== 'OpeningHoursSpecification') {
          problems.push('hours type');
          continue;
        }
        const days = Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek : [];
        if (
          days.length === 0 ||
          !days.every((day) => DAYS.includes(String(day)))
        )
          problems.push('hours days');
        const opens = String(spec.opens);
        const closes = String(spec.closes);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(opens)) problems.push('opens');
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(closes)) problems.push('closes');
        else if (opens >= closes) problems.push('closes before opens');
      }
  }
  return problems;
}

/** Rating and review markup needs real review data (Q-011: none yet); none may appear anywhere. */
function ratingKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(ratingKeys);
  if (!isJson(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    /^(aggregateRating|review|reviews|ratingValue|ratingCount|reviewCount|bestRating)$/.test(
      key,
    )
      ? [key]
      : ratingKeys(child),
  );
}

function product(edit: (view: ProductPageView) => ProductPageView = (v) => v) {
  const raw = recorded<NonNullable<CatalogProductQuery['product']>>(
    productJson.product,
  );
  return edit(mapProductPage(raw, null));
}

describe('Product JSON-LD (REQ-PDP-002, REQ-SEO-001)', () => {
  it('meets the Product and AggregateOffer requirements on the recorded product', () => {
    const ld = buildProductJsonLd(product(), ORIGIN);
    expect(productProblems(ld)).toEqual([]);
    expect((ld.offers as Json)['@type']).toBe('AggregateOffer');
  });

  it('meets the Offer requirements for a single variant, in stock and sold out', () => {
    for (const available of [true, false]) {
      const view = product((v) => ({
        ...v,
        variants: [{...v.variants[0], available}],
      }));
      const ld = buildProductJsonLd(view, ORIGIN);
      expect(productProblems(ld)).toEqual([]);
      expect((ld.offers as Json).availability).toBe(
        available
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      );
    }
  });

  it('takes price, SKU and availability from the variant, never from anywhere else', () => {
    const view = product();
    const ld = buildProductJsonLd(view, ORIGIN);
    const offers = (ld.offers as {offers: Json[]}).offers;
    expect(offers).toHaveLength(view.variants.length);
    offers.forEach((offer, index) => {
      const variant = view.variants[index];
      expect(offer.price).toBe(
        `${variant.price.amount.split('.')[0]}.${(variant.price.amount.split('.')[1] ?? '0').padEnd(2, '0')}`,
      );
      expect(offer.availability).toBe(
        variant.available
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      );
      if (variant.sku) expect(offer.sku).toBe(variant.sku);
      else expect(offer).not.toHaveProperty('sku');
    });
  });

  it('emits no rating or review markup, with or without brand data (no review source, Q-011)', () => {
    for (const view of [
      product(),
      product((v) => ({
        ...v,
        brand: {
          name: 'Acme Sleep',
          slug: 'acme-sleep',
          logo: null,
          about: [],
          warranty: [],
        },
      })),
    ]) {
      expect(ratingKeys(buildProductJsonLd(view, ORIGIN))).toEqual([]);
    }
    expect(
      ratingKeys(buildFaqJsonLd([{id: '1', question: 'Q?', answer: ['A.']}])),
    ).toEqual([]);
  });

  it('uses the brand metaobject name, then the vendor, and never an empty Brand', () => {
    const named = product((v) => ({
      ...v,
      vendor: 'Vendor Co',
      brand: {
        name: 'Acme Sleep',
        slug: null,
        logo: null,
        about: [],
        warranty: [],
      },
    }));
    expect((buildProductJsonLd(named, ORIGIN).brand as Json).name).toBe(
      'Acme Sleep',
    );
    const vendorOnly = product((v) => ({
      ...v,
      vendor: 'Vendor Co',
      brand: null,
    }));
    expect((buildProductJsonLd(vendorOnly, ORIGIN).brand as Json).name).toBe(
      'Vendor Co',
    );
    const neither = product((v) => ({...v, vendor: '  ', brand: null}));
    expect(buildProductJsonLd(neither, ORIGIN)).not.toHaveProperty('brand');
    expect(productProblems(buildProductJsonLd(neither, ORIGIN))).toEqual([]);
  });

  it('leaves out image, description and offers it does not have, rather than emitting empty ones', () => {
    const bare = product((v) => ({
      ...v,
      images: [],
      description: [],
      seoDescription: null,
      variants: [],
    }));
    const ld = buildProductJsonLd(bare, ORIGIN);
    expect(ld).not.toHaveProperty('image');
    expect(ld).not.toHaveProperty('description');
    expect(ld).not.toHaveProperty('offers');
    expect(productProblems(ld)).toEqual([]);
  });

  it('caps the description and keeps hostile text inside JSON strings', () => {
    const hostile = product((v) => ({
      ...v,
      seoDescription: null,
      description: ['</script><script>alert(1)</script>'.repeat(400)],
      title: '</script><img src=x onerror=alert(1)>',
    }));
    const ld = buildProductJsonLd(hostile, ORIGIN);
    expect(String(ld.description).length).toBeLessThanOrEqual(5000);
    // React Router serialises script:ld+json with escaping; our own serializer does the same for store data.
    const json = serializeJsonLd(ld);
    expect(json).not.toMatch(/<\/?script|<img/i);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(ld)));
  });
});

describe('BreadcrumbList JSON-LD (REQ-COL-004, REQ-SEO-001)', () => {
  it('has sequential positions, names and absolute URLs', () => {
    const ld = buildBreadcrumbJsonLd(
      [
        {name: 'Home', path: '/'},
        {name: 'Collections', path: '/collections'},
        {name: 'Firm mattresses', path: '/collections/firm'},
      ],
      ORIGIN,
    );
    expect(breadcrumbProblems(ld)).toEqual([]);
    const items = ld.itemListElement as Json[];
    expect(items.map((item) => item.item)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/collections`,
      `${ORIGIN}/collections/firm`,
    ]);
  });

  it('would carry relative URLs without an origin, which is why callers omit it then', () => {
    const ld = buildBreadcrumbJsonLd([{name: 'Home', path: '/'}], '');
    expect(breadcrumbProblems(ld)).toContain('item 0 url');
  });
});

describe('FAQPage JSON-LD (REQ-PDP-002, REQ-COL-004)', () => {
  it('meets the Question and Answer requirements', () => {
    const ld = buildFaqJsonLd([
      {
        id: '1',
        question: 'How long is the trial?',
        answer: ['100 nights.', 'Free returns.'],
      },
      {id: '2', question: 'Is delivery free?', answer: ['Over $999.']},
    ]);
    expect(ld).not.toBeNull();
    expect(faqProblems(ld ?? {})).toEqual([]);
  });

  it('emits nothing when there are no questions', () => {
    expect(buildFaqJsonLd([])).toBeNull();
  });
});

describe('LocalBusiness JSON-LD (REQ-LOC-001)', () => {
  it('meets the LocalBusiness requirements for every fixture store, complete or sparse', () => {
    expect(FIXTURE_STORES.length).toBeGreaterThanOrEqual(4);
    for (const store of FIXTURE_STORES) {
      const ld = buildStoreJsonLd(store, {siteOrigin: ORIGIN});
      expect(localBusinessProblems(ld as unknown as Json), store.id).toEqual(
        [],
      );
      expect(ratingKeys(ld), store.id).toEqual([]);
    }
  });

  it('is still valid without a site origin: the URL fields are left out, not guessed', () => {
    const ld = buildStoreJsonLd(getFixtureStore('fixture-store-buffalo'));
    expect(localBusinessProblems(ld as unknown as Json)).toEqual([]);
    expect(ld).not.toHaveProperty('url');
    expect(ld).not.toHaveProperty('@id');
  });

  it('keeps a hostile store name inside the JSON-LD script block', () => {
    const base = getFixtureStore('fixture-store-buffalo');
    const ld = buildStoreJsonLd({
      ...base,
      name: '</script><script>alert(1)</script>',
    });
    expect(serializeJsonLd(ld)).not.toMatch(/<\/?script/i);
  });
});

describe('Brand JSON-LD (REQ-COL-005)', () => {
  it('carries a name, an absolute url when the origin is known, and nothing invented', () => {
    const brand = {...FIXTURE_BRANDS[0], handle: 'acme-sleep'};
    const ld = buildBrandJsonLd(brand, ORIGIN);
    expect(ld['@type']).toBe('Brand');
    expect(text(ld.name)).toBe(true);
    expect(ld.url).toBe(`${ORIGIN}/brands/acme-sleep`);
    expect(ratingKeys(ld)).toEqual([]);
    expect(buildBrandJsonLd(brand, null)).not.toHaveProperty('url');
  });
});
