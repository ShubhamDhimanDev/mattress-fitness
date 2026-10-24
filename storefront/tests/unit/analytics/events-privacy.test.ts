import {describe, expect, it} from 'vitest';
import {
  mapBeginCheckout,
  mapCartLineChange,
  mapCartViewed,
  mapCollectionViewed,
  mapProductViewed,
  mapSearchViewed,
  mapSelectItem,
  productIdFrom,
  selectItemValue,
  centsFrom,
} from '~/lib/analytics/hydrogen-events';
import {dollarsFromCents} from '~/lib/analytics/money';
import {
  looksPersonal,
  sanitizePageLocation,
  sanitizeParams,
  sanitizeSearchTerm,
} from '~/lib/analytics/privacy';
import {
  buildQuizCompleteEvent,
  buildQuizResultClickEvent,
  buildQuizStartEvent,
} from '~/lib/quiz/events';

// P7-01: REQ-ANL-001 (event mapping), REQ-ANL-002 (no personal data), REQ-QZ-006 (quiz events pass through), T-05.

const PRODUCT_GID = 'gid://shopify/Product/9876543210';

function cartLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/CartLine/1',
    quantity: 2,
    cost: {
      amountPerQuantity: {amount: '1999.99', currencyCode: 'USD'},
      totalAmount: {amount: '3799.98', currencyCode: 'USD'},
    },
    merchandise: {
      id: 'gid://shopify/ProductVariant/1',
      title: 'Queen',
      price: {amount: '1999.99', currencyCode: 'USD'},
      product: {id: PRODUCT_GID, title: 'Cloud Mattress', vendor: 'Acme'},
    },
    ...overrides,
  };
}

describe('money in dollars from minor units (the shared helper, no float arithmetic)', () => {
  it.each([
    [0, 0],
    [1, 0.01],
    [10, 0.1],
    [199999, 1999.99],
    [123456789, 1234567.89],
  ])('%i cents is %d dollars', (cents, dollars) => {
    expect(dollarsFromCents(cents)).toBe(dollars);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %d',
    (cents) => {
      expect(dollarsFromCents(cents)).toBeUndefined();
    },
  );

  it('reads Shopify decimal strings to integer cents, USD only', () => {
    expect(centsFrom({amount: '1999.99', currencyCode: 'USD'})).toBe(199999);
    expect(centsFrom('0.10')).toBe(10);
    expect(centsFrom({amount: '10.00', currencyCode: 'CAD'})).toBeNull();
    expect(centsFrom({amount: '-5.00', currencyCode: 'USD'})).toBeNull();
    expect(centsFrom({amount: '1e3', currencyCode: 'USD'})).toBeNull();
    expect(centsFrom({amount: 12, currencyCode: 'USD'})).toBeNull();
    expect(centsFrom(null)).toBeNull();
  });

  it('product ids: gid or digits only', () => {
    expect(productIdFrom(PRODUCT_GID)).toBe('9876543210');
    expect(productIdFrom('123')).toBe('123');
    expect(productIdFrom('gid://shopify/ProductVariant/1')).toBeNull();
    expect(productIdFrom('abc')).toBeNull();
    expect(productIdFrom(42)).toBeNull();
  });
});

describe('view_item, view_item_list, search, view_cart', () => {
  it('maps a product view with value in cents', () => {
    const event = mapProductViewed({
      products: [
        {
          id: PRODUCT_GID,
          title: 'Cloud Mattress',
          vendor: 'Acme',
          variantId: 'v',
          variantTitle: 'Queen',
          price: '1999.99',
          quantity: 1,
        },
      ],
      url: 'https://x.example/products/cloud?email=a@b.co',
      shop: {shopId: 'gid://shopify/Shop/1'},
    });
    expect(event).toEqual({
      name: 'view_item',
      params: {},
      ecommerce: {
        valueCents: 199999,
        items: [
          {
            id: '9876543210',
            name: 'Cloud Mattress',
            brand: 'Acme',
            variant: 'Queen',
            priceCents: 199999,
            quantity: 1,
          },
        ],
      },
    });
  });

  it('drops the default variant title and a product with no usable price or id', () => {
    const base = {
      id: PRODUCT_GID,
      title: 'T',
      vendor: 'V',
      variantId: 'v',
      quantity: 1,
    };
    const ok = mapProductViewed({
      products: [{...base, variantTitle: 'Default Title', price: '5.00'}],
    });
    expect(ok?.ecommerce?.items[0]).not.toHaveProperty('variant');
    expect(
      mapProductViewed({
        products: [{...base, variantTitle: 'x', price: 'free'}],
      }),
    ).toBeNull();
    expect(
      mapProductViewed({
        products: [{...base, id: 'junk', variantTitle: 'x', price: '5.00'}],
      }),
    ).toBeNull();
    expect(mapProductViewed({products: []})).toBeNull();
    expect(mapProductViewed(undefined)).toBeNull();
  });

  it("Hydrogen's collection view sends nothing: the listing code sends view_item_list with the products", () => {
    expect(
      mapCollectionViewed({collection: {id: 'x', handle: 'queen-mattresses'}}),
    ).toBeNull();
    expect(
      mapCollectionViewed({collection: {handle: 'A B<script>'}}),
    ).toBeNull();
    expect(mapCollectionViewed(undefined)).toBeNull();
  });

  it('search carries the term, trimmed and capped, and never an email or a phone number', () => {
    expect(mapSearchViewed({searchTerm: '  firm   queen  '})?.params).toEqual({
      search_term: 'firm queen',
    });
    expect(
      mapSearchViewed({searchTerm: 'x'.repeat(300)})?.params.search_term,
    ).toHaveLength(100);
    expect(mapSearchViewed({searchTerm: 'jane@example.com'})).toBeNull();
    expect(mapSearchViewed({searchTerm: 'call 555 123 4567'})).toBeNull();
    expect(mapSearchViewed({searchTerm: ''})).toBeNull();
    expect(mapSearchViewed({searchTerm: {toString: 'x'}})).toBeNull();
  });

  it('view_cart reads the lines, nodes or edges', () => {
    const viaNodes = mapCartViewed({cart: {lines: {nodes: [cartLine()]}}});
    const viaEdges = mapCartViewed({
      cart: {lines: {edges: [{node: cartLine()}]}},
    });
    expect(viaNodes?.name).toBe('view_cart');
    expect(viaEdges).toEqual(viaNodes);
  });
});

describe('add_to_cart and remove_from_cart report the units that changed', () => {
  it('a line going from 1 to 3 is an add of 2 at the unit price', () => {
    const event = mapCartLineChange('add', {
      prevLine: cartLine({quantity: 1}),
      currentLine: cartLine({quantity: 3}),
    });
    expect(event?.name).toBe('add_to_cart');
    expect(event?.ecommerce?.items[0]).toMatchObject({
      quantity: 2,
      priceCents: 199999,
    });
    expect(event?.ecommerce?.valueCents).toBe(399998);
  });

  it('a new line is an add of its whole quantity', () => {
    const event = mapCartLineChange('add', {
      currentLine: cartLine({quantity: 1}),
    });
    expect(event?.ecommerce?.items[0]?.quantity).toBe(1);
  });

  it('a removed line is a remove of what it held', () => {
    const event = mapCartLineChange('remove', {
      prevLine: cartLine({quantity: 2}),
    });
    expect(event?.name).toBe('remove_from_cart');
    expect(event?.ecommerce?.items[0]?.quantity).toBe(2);
  });

  it('no change, a wrong direction or a line without a price is not an event', () => {
    expect(
      mapCartLineChange('add', {
        prevLine: cartLine({quantity: 2}),
        currentLine: cartLine({quantity: 2}),
      }),
    ).toBeNull();
    expect(
      mapCartLineChange('add', {
        prevLine: cartLine({quantity: 3}),
        currentLine: cartLine({quantity: 1}),
      }),
    ).toBeNull();
    expect(
      mapCartLineChange('add', {
        currentLine: cartLine({
          cost: {},
          merchandise: {title: 'x', product: {id: PRODUCT_GID, title: 'T'}},
        }),
      }),
    ).toBeNull();
  });

  it('a tampered quantity is capped, not trusted', () => {
    const event = mapCartLineChange('add', {
      currentLine: cartLine({quantity: 1_000_000}),
    });
    expect(event?.ecommerce?.items[0]?.quantity).toBe(99);
  });
});

describe('begin_checkout (at hand-off)', () => {
  it('sums the Shopify line totals and lists each line', () => {
    const event = mapBeginCheckout({
      lines: {
        nodes: [
          cartLine(),
          cartLine({
            quantity: 1,
            cost: {
              amountPerQuantity: {amount: '50.00', currencyCode: 'USD'},
              totalAmount: {amount: '45.00', currencyCode: 'USD'},
            },
          }),
        ],
      },
    });
    expect(event?.name).toBe('begin_checkout');
    expect(event?.ecommerce?.valueCents).toBe(379998 + 4500);
    expect(event?.ecommerce?.items).toHaveLength(2);
  });

  it('never reads or forwards the buyer fields of the cart', () => {
    const event = mapBeginCheckout({
      buyerIdentity: {
        email: 'jane@example.com',
        phone: '+15555550123',
        customer: {firstName: 'Jane'},
      },
      lines: {nodes: [cartLine()]},
    });
    expect(JSON.stringify(event)).not.toMatch(/jane|5555550123|buyer/i);
  });

  it('an empty or missing cart is not an event', () => {
    expect(mapBeginCheckout({lines: {nodes: []}})).toBeNull();
    expect(mapBeginCheckout(null)).toBeNull();
  });
});

describe('select_item', () => {
  it('round-trips through the single data-si value and the link text', () => {
    const value = selectItemValue({
      productId: '123',
      priceCents: 99900,
      listId: 'queen',
      index: 3,
    });
    expect(value).toBe('123|99900|3|queen');
    expect(mapSelectItem(value, '  Cloud   Mattress\n')).toEqual({
      name: 'select_item',
      params: {},
      ecommerce: {
        listId: 'queen',
        listName: 'queen',
        items: [
          {
            id: '123',
            name: 'Cloud Mattress',
            priceCents: 99900,
            quantity: 1,
            index: 3,
          },
        ],
      },
    });
  });

  it('takes a Shopify gid, and an empty list id or position leaves them out', () => {
    const event = mapSelectItem('gid://shopify/Product/55|100||', 'N');
    expect(event?.ecommerce?.items[0]).toEqual({
      id: '55',
      name: 'N',
      priceCents: 100,
      quantity: 1,
    });
    expect(event?.ecommerce?.listId).toBeUndefined();
  });

  it.each([
    ['no value', null, 'N'],
    ['a non-numeric price', '1|1e5|0|a', 'N'],
    ['a negative price', '1|-5|0|a', 'N'],
    ['a price of ten digits', '1|1234567890|0|a', 'N'],
    ['a non-numeric id', 'abc|100|0|a', 'N'],
    ['a variant gid', 'gid://shopify/ProductVariant/1|100|0|a', 'N'],
    ['no id', '|100|0|a', 'N'],
    ['too few parts', '1|100|0', 'N'],
    ['too many parts', '1|100|0|a|b', 'N'],
    ['a list id holding the delimiter', '1|100|0|a|b', 'N'],
    ['no title', '1|100|0|a', null],
    ['a blank title', '1|100|0|a', '   '],
    ['an oversized value', `1|100|0|${'a'.repeat(400)}`, 'N'],
  ])('refuses %s', (_label, value, label) => {
    expect(mapSelectItem(value, label)).toBeNull();
  });

  it('leaves out a hostile list id or position and keeps the item', () => {
    const event = mapSelectItem('1|100|-1|<script>', 'N');
    expect(event?.ecommerce?.items[0]?.index).toBeUndefined();
    expect(event?.ecommerce?.listId).toBeUndefined();
    expect(event?.ecommerce?.items[0]?.id).toBe('1');
  });

  it('caps the title and never carries a brand', () => {
    const event = mapSelectItem('1|100|0|a', 'x'.repeat(300));
    expect(event?.ecommerce?.items[0]?.name).toHaveLength(100);
    expect(event?.ecommerce?.items[0]).not.toHaveProperty('brand');
  });
});

describe('quiz events (REQ-QZ-006) keep their documented parameters', () => {
  it('start, complete and result click are all forwardable names with flat params', () => {
    const start = buildQuizStartEvent({questionCount: 5, entryPoint: 'home'});
    const click = buildQuizResultClickEvent({
      handle: 'cloud',
      position: 1,
      size: 'Queen',
      target: 'product',
    });
    for (const event of [start, click]) {
      expect(Object.keys(sanitizeParams(event.params)).sort()).toEqual(
        Object.keys(event.params).sort(),
      );
    }
    expect(buildQuizCompleteEvent).toBeTypeOf('function');
  });
});

describe('what may leave the browser (T-05, REQ-ANL-002)', () => {
  it('drops parameters that look personal by name or by value', () => {
    const safe = sanitizeParams({
      item_id: '123',
      quantity: 2,
      email: 'jane@example.com',
      customer_id: '99',
      zip_code: '90210',
      order_number: '1001',
      note: 'write to jane@example.com',
      phone_note: '555-123-4567',
      call_me: '(555) 123 4567',
      'Bad Name': 'x',
      ratio: Number.NaN,
    });
    expect(safe).toEqual({item_id: '123', quantity: 2});
  });

  it('caps string length and the number of parameters', () => {
    const many = Object.fromEntries(
      Array.from({length: 60}, (_, i) => [`p${i}`, i]),
    );
    expect(Object.keys(sanitizeParams(many))).toHaveLength(25);
    expect(sanitizeParams({text: 'a'.repeat(500)}).text).toHaveLength(100);
  });

  it('recognises emails and long digit runs', () => {
    expect(looksPersonal('a@b.co')).toBe(true);
    expect(looksPersonal('1234567')).toBe(true);
    expect(looksPersonal('555-123-4567')).toBe(true);
    expect(looksPersonal('firm queen 2025')).toBe(false);
    expect(sanitizeSearchTerm('queen 12')).toBe('queen 12');
  });

  it('reports the page address without search words, filters, ZIP or order and account detail', () => {
    expect(
      sanitizePageLocation(
        'https://shop.example/search?q=jane%40x.com&zip=90210',
      ),
    ).toBe('https://shop.example/search');
    expect(
      sanitizePageLocation(
        'https://shop.example/products/cloud?utm_source=news&utm_campaign=fall&variant=1&fbclid=IwAR0abc123456789',
      ),
    ).toBe(
      'https://shop.example/products/cloud?utm_source=news&utm_campaign=fall&fbclid=IwAR0abc123456789',
    );
    expect(
      sanitizePageLocation(
        'https://shop.example/account/orders/1234567890?x=1',
      ),
    ).toBe('https://shop.example/account');
    expect(
      sanitizePageLocation('https://shop.example/discount/SECRETCODE'),
    ).toBe('https://shop.example/discount');
    expect(
      sanitizePageLocation('https://shop.example/x?utm_source=jane@x.com'),
    ).toBe('https://shop.example/x');
    expect(sanitizePageLocation('javascript:alert(1)')).toBeNull();
    expect(sanitizePageLocation('not a url')).toBeNull();
    expect(sanitizePageLocation(undefined)).toBeNull();
  });

  it('page_location survives sanitizeParams in its reduced form, with digits in the path', () => {
    expect(
      sanitizeParams({
        page_location: 'https://shop.example/products/mattress-2025?x=1',
      }).page_location,
    ).toBe('https://shop.example/products/mattress-2025');
  });
});
