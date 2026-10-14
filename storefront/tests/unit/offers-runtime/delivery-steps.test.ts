import {describe, expect, it, vi} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {
  acceptHaulAway,
  chooseDelivery,
  declineHaulAway,
} from '~/lib/delivery-runtime/steps';
import {
  revalidateCartOffers,
  type OfferRuntime,
} from '~/lib/offers-runtime/server';
import {
  ENV,
  FakeCart,
  GID,
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// P5B-04 / P3B-11: REQ-PRE-003 (haul-away only for in-home inside the zone, capped at the admin maximum),
// REQ-PRE-005 (decline recorded), REQ-PRE-006 (server decides), REQ-DEL-001 (zone from one source).
// The zone in the fixtures covers 606* and 60007; the haul-away maximum is 2.

const IN_ZONE = '60645';
const OUT_OF_ZONE = '90210';

const OTHER_LINE = {
  id: 'gid://shopify/CartLine/o',
  variantId: GID.otherVariant,
  productId: GID.other,
};
const HAUL_LINE = {
  id: 'gid://shopify/CartLine/haul',
  variantId: GID.haulVariant,
  productId: GID.haul,
};
const IN_HOME = [{key: 'delivery_choice', value: 'in-home'}];

function runtime(
  fake: FakeCart,
  options: {zip?: string | null; soldOut?: string[]} = {},
): OfferRuntime {
  const {storefront} = fakeStorefront(
    storefrontResponder({soldOut: options.soldOut ?? []}),
  );
  return {
    storefront,
    cart: fake,
    env: ENV,
    production: true,
    zip: options.zip === undefined ? IN_ZONE : options.zip,
  };
}

async function viewOf(fake: FakeCart, zip: string | null = IN_ZONE) {
  const result = await revalidateCartOffers(
    runtime(fake, {zip}),
    fake.snapshot(),
  );
  return result;
}

describe('delivery question (REQ-PRE-003, P5B-04)', () => {
  it('is asked for a saved ZIP inside the zone, with the approved wording, and comes before haul-away', async () => {
    const fake = new FakeCart([OTHER_LINE]);
    const {view} = await viewOf(fake);
    expect(view?.nextStep).toBe('delivery-choice');
    expect(view?.deliveryChoice).toEqual({
      status: 'pending',
      choice: null,
      promises: {inHome: 'White-glove.', pickup: 'Ready.'},
    });
    expect(view?.haulAway).toBeNull();
  });

  it.each([
    ['no saved ZIP', null],
    ['a ZIP outside the zone', OUT_OF_ZONE],
    ['a ZIP that is not a ZIP', 'abcde'],
  ])('is not asked with %s: the shopper simply continues', async (_n, zip) => {
    const fake = new FakeCart([OTHER_LINE]);
    const {view, check} = await viewOf(fake, zip);
    expect(view?.deliveryChoice).toBeNull();
    expect(view?.haulAway).toBeNull();
    expect(view?.nextStep).toBeNull();
    expect(check?.blocked).toEqual([]);
  });

  it('is not asked when the service cannot be bought (sold out), so it never stalls checkout', async () => {
    const fake = new FakeCart([OTHER_LINE]);
    const {view} = await revalidateCartOffers(
      runtime(fake, {soldOut: [GID.haulVariant]}),
      fake.snapshot(),
    );
    expect(view?.deliveryChoice).toBeNull();
    expect(view?.nextStep).toBeNull();
  });

  it('records in-home as the documented attribute and then offers haul-away', async () => {
    const fake = new FakeCart([OTHER_LINE]);
    const outcome = await chooseDelivery(
      runtime(fake),
      fake.snapshot(),
      'in-home',
    );
    expect(outcome.status).toBe('ok');
    expect(fake.attributeValue('delivery_choice')).toBe('in-home');

    const {view} = await viewOf(fake);
    expect(view?.deliveryChoice).toMatchObject({
      status: 'answered',
      choice: 'in-home',
    });
    expect(view?.haulAway).toMatchObject({
      status: 'pending',
      maxPieces: 2,
      currentQuantity: 0,
    });
    expect(view?.haulAway?.variant.variantId).toBe(GID.haulVariant);
    expect(view?.nextStep).toBe('haul-away');
  });

  it('records pickup and then offers nothing more (haul-away is for in-home only)', async () => {
    const fake = new FakeCart([OTHER_LINE]);
    await chooseDelivery(runtime(fake), fake.snapshot(), 'pickup');
    expect(fake.attributeValue('delivery_choice')).toBe('pickup');
    const {view} = await viewOf(fake);
    expect(view?.haulAway).toBeNull();
    expect(view?.nextStep).toBeNull();
  });

  it('keeps other cart attributes when it writes the choice', async () => {
    const fake = new FakeCart([OTHER_LINE], {
      attributes: [{key: 'gift_note', value: 'hello'}],
    });
    await chooseDelivery(runtime(fake), fake.snapshot(), 'pickup');
    expect(fake.attributeValue('gift_note')).toBe('hello');
  });

  it.each([
    ['outside the zone', OUT_OF_ZONE],
    ['no saved ZIP', null],
  ])(
    'refuses a forged in-home answer with %s and writes nothing',
    async (_n, zip) => {
      const fake = new FakeCart([OTHER_LINE]);
      const outcome = await chooseDelivery(
        runtime(fake, {zip}),
        fake.snapshot(),
        'in-home',
      );
      expect(outcome).toMatchObject({
        status: 'rejected',
        code: 'delivery-choice-unavailable',
      });
      expect(fake.calls.filter((c) => c.method === 'updateAttributes')).toEqual(
        [],
      );
      expect(fake.attributeValue('delivery_choice')).toBeUndefined();
    },
  );

  it('does not trust an in-home attribute alone: outside the zone the cart is not eligible', async () => {
    const fake = new FakeCart([OTHER_LINE, {...HAUL_LINE}], {
      attributes: IN_HOME,
    });
    const {check, view} = await viewOf(fake, OUT_OF_ZONE);
    expect(check?.status).toBe('blocked');
    expect(check?.blocked[0]?.code).toBe('haul-away-not-eligible');
    expect(view?.haulAway).toBeNull();
  });

  it('reports a failed write as a known failure the shopper can move on from', async () => {
    const fake = new FakeCart([OTHER_LINE]);
    fake.failNext = true;
    const outcome = await chooseDelivery(
      runtime(fake),
      fake.snapshot(),
      'pickup',
    );
    expect(outcome).toMatchObject({status: 'rejected', code: 'record-failed'});
  });
});

describe('haul-away step (REQ-PRE-003, REQ-PRE-005, REQ-PRE-006)', () => {
  const ready = () => new FakeCart([OTHER_LINE], {attributes: IN_HOME});

  it('adds exactly the pieces asked for, as the rule variant, after resetting any decline', async () => {
    const fake = ready();
    const outcome = await acceptHaulAway(runtime(fake), fake.snapshot(), 1);
    expect(outcome.status).toBe('ok');
    const mutations = fake.calls.map((call) => call.method);
    expect(mutations.indexOf('updateAttributes')).toBeLessThan(
      mutations.indexOf('addLines'),
    );
    expect(fake.calls.find((c) => c.method === 'addLines')).toMatchObject({
      lines: [{merchandiseId: GID.haulVariant, quantity: 1}],
    });
    expect(fake.attributeValue('offer_declined_haul_away')).toBe('no');

    const {view, check} = await viewOf(fake);
    expect(view?.haulAway).toMatchObject({
      status: 'accepted',
      currentQuantity: 1,
    });
    expect(view?.nextStep).toBeNull();
    expect(check?.blocked).toEqual([]);
  });

  it('caps the quantity at the admin maximum, whatever was asked for', async () => {
    const fake = ready();
    await acceptHaulAway(runtime(fake), fake.snapshot(), 99);
    expect(fake.calls.find((c) => c.method === 'addLines')).toMatchObject({
      lines: [{quantity: 2}],
    });
    const lineQuantity = fake
      .snapshot()
      .lines.nodes.find((n) => n.merchandise.id === GID.haulVariant)?.quantity;
    expect(lineQuantity).toBe(2);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses an unusable quantity (%s) and changes nothing',
    async (pieces) => {
      const fake = ready();
      const outcome = await acceptHaulAway(
        runtime(fake),
        fake.snapshot(),
        pieces,
      );
      expect(outcome).toMatchObject({
        status: 'rejected',
        code: 'quantity-invalid',
      });
      expect(fake.calls).toEqual([]);
    },
  );

  it('refuses when in-home was not chosen, whatever the form says', async () => {
    const fake = new FakeCart([OTHER_LINE]);
    const outcome = await acceptHaulAway(runtime(fake), fake.snapshot(), 1);
    expect(outcome).toMatchObject({
      status: 'rejected',
      code: 'haul-away-unavailable',
    });
    expect(fake.calls).toEqual([]);
  });

  it.each([
    ['pickup', [{key: 'delivery_choice', value: 'pickup'}], IN_ZONE],
    ['a ZIP outside the zone', IN_HOME, OUT_OF_ZONE],
    ['no saved ZIP', IN_HOME, null],
  ])('refuses with %s', async (_n, attributes, zip) => {
    const fake = new FakeCart([OTHER_LINE], {attributes});
    const outcome = await acceptHaulAway(
      runtime(fake, {zip}),
      fake.snapshot(),
      1,
    );
    expect(outcome.status).toBe('rejected');
    expect(fake.calls.filter((c) => c.method === 'addLines')).toEqual([]);
  });

  it('refuses a second add while pieces are already in the cart (no stacking past the maximum)', async () => {
    const fake = new FakeCart([OTHER_LINE, {...HAUL_LINE, quantity: 2}], {
      attributes: IN_HOME,
    });
    const outcome = await acceptHaulAway(runtime(fake), fake.snapshot(), 2);
    expect(outcome).toMatchObject({
      status: 'rejected',
      code: 'haul-away-unavailable',
    });
    expect(fake.calls.filter((c) => c.method === 'addLines')).toEqual([]);
  });

  it('lowers a cart that is over the maximum (made by other means) and tells the shopper', async () => {
    const fake = new FakeCart([OTHER_LINE, {...HAUL_LINE, quantity: 5}], {
      attributes: IN_HOME,
    });
    const {check, view} = await viewOf(fake);
    expect(fake.quantityOf(HAUL_LINE.id)).toBe(2);
    expect(check?.status).toBe('corrected');
    expect(view?.notices.join(' ')).toMatch(/reduced to the maximum/i);
  });

  it('a failed add leaves no service line and no recorded decline (the step is still open)', async () => {
    const fake = ready();
    vi.spyOn(fake, 'addLines').mockResolvedValue({
      userErrors: [{message: 'nope'}],
    });
    const outcome = await acceptHaulAway(runtime(fake), fake.snapshot(), 1);
    expect(outcome).toMatchObject({status: 'rejected', code: 'add-failed'});
    expect(fake.attributeValue('offer_declined_haul_away')).toBe('no');
    const {view} = await viewOf(fake);
    expect(view?.haulAway?.status).toBe('pending');
  });

  it('declining is recorded and ends the step; accepting after a decline clears it', async () => {
    const fake = ready();
    const declined = await declineHaulAway(runtime(fake), fake.snapshot());
    expect(declined.status).toBe('ok');
    expect(fake.attributeValue('offer_declined_haul_away')).toBe('yes');
    const after = await viewOf(fake);
    expect(after.view?.haulAway?.status).toBe('declined');
    expect(after.view?.nextStep).toBeNull();

    await acceptHaulAway(runtime(fake), fake.snapshot(), 1);
    expect(fake.attributeValue('offer_declined_haul_away')).toBe('no');
  });

  it('the shopper can always decline: even a failed write is reported, not trapped', async () => {
    const fake = ready();
    fake.failNext = true;
    expect(await declineHaulAway(runtime(fake), fake.snapshot())).toMatchObject(
      {status: 'rejected', code: 'record-failed'},
    );
    expect(await declineHaulAway(runtime(fake), null)).toMatchObject({
      status: 'rejected',
      code: 'cart-gone',
    });
  });
});
