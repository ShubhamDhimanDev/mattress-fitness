import {describe, expect, it} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {
  acceptComfortGuarantee,
  declineComfortGuarantee,
  revalidateCartOffers,
  swapLineSize,
  type OfferRuntime,
} from '~/lib/offers-runtime/server';
import {
  ENV,
  FakeCart,
  GID,
  MATTRESS_LINE,
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// REQ-CART-001 (size swap), REQ-CART-002..004 (offers view), REQ-PRE-002 (comfort guarantee),
// REQ-PRE-005 (decline recorded), REQ-PRE-006 (server decides what is added).

function runtime(fake: FakeCart, soldOut: string[] = []): OfferRuntime {
  const {storefront} = fakeStorefront(storefrontResponder({soldOut}));
  return {storefront, cart: fake, env: ENV};
}

const OTHER_LINE = {
  id: 'gid://shopify/CartLine/o',
  variantId: GID.otherVariant,
  productId: GID.other,
};

describe('offers view (REQ-CART-002, REQ-CART-003, REQ-CART-004)', () => {
  it('offers the gift and the size-matched add-on for a qualifying mattress', async () => {
    const fake = new FakeCart([MATTRESS_LINE], {subtotalCents: 50000});
    const {view} = await revalidateCartOffers(runtime(fake), fake.snapshot());
    expect(view?.gifts.map((gift) => gift.name)).toEqual(['Free pillow']);
    expect(view?.gifts[0].sizes[0].variant.variantId).toBe(GID.gift);
    expect(view?.addOns.map((addOn) => addOn.variant.variantId)).toEqual([
      GID.pillowVariant,
    ]);
    expect(view?.freeDelivery).toMatchObject({
      enabled: true,
      remainingCents: 49900,
      reached: false,
      percent: 50,
    });
  });

  it('shows no offer for a cart that does not qualify', async () => {
    const fake = new FakeCart([OTHER_LINE]);
    const {view} = await revalidateCartOffers(runtime(fake), fake.snapshot());
    expect(view?.gifts).toEqual([]);
    expect(view?.addOns).toEqual([]);
  });

  it('never offers a sold-out variant, and a sold-out protector does not stall checkout', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {view} = await revalidateCartOffers(
      runtime(fake, [GID.gift, GID.pillowVariant, GID.protectorQueen]),
      fake.snapshot(),
    );
    expect(view?.gifts).toEqual([]);
    expect(view?.addOns).toEqual([]);
    expect(view?.nextStep).toBeNull();
  });

  it('asks for the comfort guarantee step while the protector is missing, and not after a decline', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const first = await revalidateCartOffers(runtime(fake), fake.snapshot());
    expect(first.view?.nextStep).toBe('comfort-guarantee');
    expect(first.view?.comfortGuarantee?.options[0]).toMatchObject({
      size: 'Queen',
      quantityMissing: 1,
    });

    await declineComfortGuarantee(runtime(fake), fake.snapshot());
    const after = await revalidateCartOffers(runtime(fake), fake.snapshot());
    expect(after.view?.nextStep).toBeNull();
  });

  it('lists the sizes a regular line can be swapped to, but not for offer-only lines', async () => {
    const fake = new FakeCart([MATTRESS_LINE, {...OTHER_LINE}]);
    const {view} = await revalidateCartOffers(runtime(fake), fake.snapshot());
    expect(view?.lineSizes[MATTRESS_LINE.id]?.map((s) => s.size)).toEqual([
      'Queen',
      'King',
    ]);
    expect(view?.lineSizes[OTHER_LINE.id]).toBeUndefined();
  });
});

describe('size swap (REQ-CART-001)', () => {
  const change = (merchandiseId: string) => ({
    lineId: MATTRESS_LINE.id,
    merchandiseId,
  });

  it('swaps to another size of the same product and keeps the quantity', async () => {
    const fake = new FakeCart([{...MATTRESS_LINE, quantity: 2}]);
    const result = await swapLineSize(
      runtime(fake),
      fake.snapshot(),
      change(GID.mattressKing),
    );
    expect(result.status).toBe('ok');
    expect(fake.calls).toEqual([
      {
        method: 'updateLines',
        lines: [
          {
            id: MATTRESS_LINE.id,
            quantity: 2,
            merchandiseId: GID.mattressKing,
          },
        ],
      },
    ]);
  });

  it('refuses a variant of another product (tampered merchandise id)', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await swapLineSize(
      runtime(fake),
      fake.snapshot(),
      change(GID.protectorKing),
    );
    expect(result).toEqual({
      status: 'rejected',
      reason: 'That size is not available.',
    });
    expect(fake.calls).toEqual([]);
  });

  it('refuses a sold-out size', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await swapLineSize(
      runtime(fake, [GID.mattressKing]),
      fake.snapshot(),
      change(GID.mattressKing),
    );
    expect(result.status).toBe('rejected');
    expect(fake.calls).toEqual([]);
  });

  it('refuses a line that is not in the cart and an offer-only line', async () => {
    const fake = new FakeCart([
      MATTRESS_LINE,
      {
        id: 'gid://shopify/CartLine/gift',
        variantId: GID.gift,
        productId: GID.giftPillow,
      },
    ]);
    const missing = await swapLineSize(runtime(fake), fake.snapshot(), {
      lineId: 'gid://shopify/CartLine/nope',
      merchandiseId: GID.mattressKing,
    });
    expect(missing.status).toBe('rejected');
    const gift = await swapLineSize(runtime(fake), fake.snapshot(), {
      lineId: 'gid://shopify/CartLine/gift',
      merchandiseId: GID.gift,
    });
    expect(gift).toEqual({
      status: 'rejected',
      reason: 'The size of this item cannot be changed.',
    });
    expect(fake.calls).toEqual([]);
  });
});

describe('pre-checkout step actions (REQ-PRE-002, REQ-PRE-005, REQ-PRE-006)', () => {
  it('accept adds exactly what the engine says is missing, with no browser-supplied variant', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await acceptComfortGuarantee(runtime(fake), fake.snapshot());
    expect(result.status).toBe('ok');
    expect(fake.calls[0]).toEqual({
      method: 'addLines',
      lines: [{merchandiseId: GID.protectorQueen, quantity: 1}],
    });
    expect(fake.attributeValue('offer_declined_comfort_guarantee')).toBe('no');
  });

  it('accept clears an earlier decline but keeps the other attributes', async () => {
    const fake = new FakeCart([MATTRESS_LINE], {
      attributes: [
        {key: 'offer_declined_comfort_guarantee', value: 'yes'},
        {key: 'delivery_choice', value: 'in-home'},
      ],
    });
    await acceptComfortGuarantee(runtime(fake), fake.snapshot());
    expect(fake.attributeValue('offer_declined_comfort_guarantee')).toBe('no');
    expect(fake.attributeValue('delivery_choice')).toBe('in-home');
  });

  it('accept with nothing to add is refused', async () => {
    const fake = new FakeCart([OTHER_LINE]);
    const result = await acceptComfortGuarantee(runtime(fake), fake.snapshot());
    expect(result.status).toBe('rejected');
    expect(fake.calls).toEqual([]);
  });

  it('decline writes the documented attribute and keeps existing ones', async () => {
    const fake = new FakeCart([MATTRESS_LINE], {
      attributes: [{key: 'delivery_choice', value: 'pickup'}],
    });
    const result = await declineComfortGuarantee(
      runtime(fake),
      fake.snapshot(),
    );
    expect(result.status).toBe('ok');
    expect(fake.attributeValue('offer_declined_comfort_guarantee')).toBe('yes');
    expect(fake.attributeValue('delivery_choice')).toBe('pickup');
  });

  it('decline on an empty cart is refused', async () => {
    const fake = new FakeCart([]);
    const result = await declineComfortGuarantee(
      runtime(fake),
      fake.snapshot(),
    );
    expect(result.status).toBe('rejected');
  });
});
