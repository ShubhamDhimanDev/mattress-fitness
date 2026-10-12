import {describe, expect, it} from 'vitest';
import {
  DECLINE_ATTRIBUTE_KEYS,
  DELIVERY_CHOICE_ATTRIBUTE,
  clearAllDeclineAttributes,
  clearDeclineAttribute,
  declineAttribute,
  deliveryChoiceAttribute,
  isOfferAttributeKey,
  parseDeclinableOffer,
  parseDeliveryChoice,
  parseOfferAttributes,
} from '~/lib/offers/attributes';
import type {DeclinableOffer} from '~/lib/offers/types';

const NOTHING_DECLINED = {
  'comfort-guarantee': false,
  'haul-away': false,
  'accident-protection': false,
};

// REQ-PRE-005: the attribute names are a contract with Shopify admin and the Phase 5B checks.
describe('offer attribute names (REQ-PRE-005)', () => {
  it('are fixed', () => {
    expect(DECLINE_ATTRIBUTE_KEYS).toEqual({
      'comfort-guarantee': 'offer_declined_comfort_guarantee',
      'haul-away': 'offer_declined_haul_away',
      'accident-protection': 'offer_declined_protection',
    });
    expect(DELIVERY_CHOICE_ATTRIBUTE).toBe('delivery_choice');
  });
});

describe('attribute builders (REQ-PRE-005)', () => {
  it.each([
    ['comfort-guarantee', 'offer_declined_comfort_guarantee'],
    ['haul-away', 'offer_declined_haul_away'],
    ['accident-protection', 'offer_declined_protection'],
  ] as const)('decline and clear for %s', (offer, key) => {
    expect(declineAttribute(offer)).toEqual({key, value: 'yes'});
    expect(clearDeclineAttribute(offer)).toEqual({key, value: 'no'});
  });

  it('clears every decline with explicit values, never by omission', () => {
    expect(clearAllDeclineAttributes()).toEqual([
      {key: 'offer_declined_comfort_guarantee', value: 'no'},
      {key: 'offer_declined_haul_away', value: 'no'},
      {key: 'offer_declined_protection', value: 'no'},
    ]);
  });

  it('writes the delivery choice', () => {
    expect(deliveryChoiceAttribute('in-home')).toEqual({
      key: 'delivery_choice',
      value: 'in-home',
    });
    expect(deliveryChoiceAttribute('pickup').value).toBe('pickup');
  });

  it('round-trips through the parser, as a list and as a record', () => {
    const attributes = [
      declineAttribute('haul-away'),
      declineAttribute('accident-protection'),
      clearDeclineAttribute('comfort-guarantee'),
      deliveryChoiceAttribute('pickup'),
    ];
    const expected = {
      deliveryChoice: 'pickup',
      declined: {
        'comfort-guarantee': false,
        'haul-away': true,
        'accident-protection': true,
      },
    };
    expect(parseOfferAttributes(attributes)).toEqual(expected);
    expect(
      parseOfferAttributes(
        Object.fromEntries(attributes.map(({key, value}) => [key, value])),
      ),
    ).toEqual(expected);
  });

  it('a later accept overrides an earlier decline', () => {
    const state = parseOfferAttributes([
      declineAttribute('haul-away'),
      clearDeclineAttribute('haul-away'),
    ]);
    expect(state.declined['haul-away']).toBe(false);
  });
});

describe('parseOfferAttributes ignores unknown and tampered input (REQ-PRE-005, REQ-PRE-006)', () => {
  it.each([null, undefined, 'declined', 42, true, [], {}, [null, 1, 'x']])(
    'treats %j as an empty cart',
    (source) => {
      expect(parseOfferAttributes(source)).toEqual({
        deliveryChoice: null,
        declined: NOTHING_DECLINED,
      });
    },
  );

  it.each(['no', 'true', '1', 'y', 'declined', 'yes please', '', '  ', 'YESS'])(
    'does not read the decline value %j as a decline',
    (value) => {
      const state = parseOfferAttributes({offer_declined_haul_away: value});
      expect(state.declined['haul-away']).toBe(false);
    },
  );

  it.each(['yes', 'YES', ' Yes '])('reads %j as a decline', (value) => {
    const state = parseOfferAttributes({offer_declined_haul_away: value});
    expect(state.declined['haul-away']).toBe(true);
  });

  it.each([
    'teleport',
    'in_home',
    'inhome',
    'in home',
    'home',
    'delivery',
    'pickup;in-home',
    'in-home\npickup',
    '',
    '<script>',
  ])('does not read the delivery choice %j', (value) => {
    expect(
      parseOfferAttributes({delivery_choice: value}).deliveryChoice,
    ).toBeNull();
  });

  it.each([
    ['in-home', 'in-home'],
    [' PICKUP ', 'pickup'],
    ['In-Home', 'in-home'],
  ])('normalises the delivery choice %j to %j', (value, expected) => {
    expect(parseOfferAttributes({delivery_choice: value}).deliveryChoice).toBe(
      expected,
    );
  });

  it('ignores keys with the wrong case, extra whitespace or a prefix', () => {
    const state = parseOfferAttributes({
      Offer_Declined_Haul_Away: 'yes',
      ' offer_declined_haul_away': 'yes',
      'offer_declined_haul_away ': 'yes',
      x_offer_declined_haul_away: 'yes',
      Delivery_Choice: 'pickup',
    });
    expect(state).toEqual({deliveryChoice: null, declined: NOTHING_DECLINED});
  });

  it('ignores non-string values and malformed list items', () => {
    const state = parseOfferAttributes([
      {key: 'offer_declined_haul_away', value: true},
      {key: 'offer_declined_protection', value: null},
      {key: 'offer_declined_comfort_guarantee'},
      {value: 'yes'},
      {key: 42, value: 'yes'},
      'offer_declined_haul_away=yes',
      null,
    ]);
    expect(state).toEqual({deliveryChoice: null, declined: NOTHING_DECLINED});
  });

  it('ignores non-string values in a record', () => {
    const state = parseOfferAttributes({
      offer_declined_haul_away: 1,
      delivery_choice: ['pickup'],
    });
    expect(state).toEqual({deliveryChoice: null, declined: NOTHING_DECLINED});
  });

  it('survives a prototype-pollution attempt in keys', () => {
    const hostile = JSON.parse(
      '{"__proto__": {"offer_declined_haul_away": "yes"}, "constructor": "yes", "offer_declined_protection": "yes"}',
    );
    const state = parseOfferAttributes(hostile);
    expect(state.declined['haul-away']).toBe(false);
    expect(state.declined['accident-protection']).toBe(true);
    // The hostile "__proto__" payload must not have polluted every object.
    expect('offer_declined_haul_away' in {}).toBe(false);
  });

  it('the last duplicate in a list wins', () => {
    const state = parseOfferAttributes([
      {key: 'delivery_choice', value: 'pickup'},
      {key: 'delivery_choice', value: 'in-home'},
    ]);
    expect(state.deliveryChoice).toBe('in-home');
  });

  it('reads a very large attribute list without trouble', () => {
    const noise = Array.from({length: 5000}, (_, index) => ({
      key: `noise_${index}`,
      value: 'yes',
    }));
    const state = parseOfferAttributes([
      ...noise,
      declineAttribute('haul-away'),
    ]);
    expect(state.declined['haul-away']).toBe(true);
  });
});

describe('boundary validation helpers (REQ-PRE-006)', () => {
  it.each([
    'comfort-guarantee',
    'haul-away',
    'accident-protection',
  ] satisfies DeclinableOffer[])('parseDeclinableOffer accepts %s', (offer) => {
    expect(parseDeclinableOffer(offer)).toBe(offer);
  });

  it.each([
    '',
    'protection',
    'Haul-Away',
    'haul-away ',
    null,
    undefined,
    1,
    {},
    ['haul-away'],
  ])('parseDeclinableOffer rejects %j', (value) => {
    expect(parseDeclinableOffer(value)).toBeNull();
  });

  it('parseDeliveryChoice accepts only the two choices', () => {
    expect(parseDeliveryChoice('in-home')).toBe('in-home');
    expect(parseDeliveryChoice('pickup')).toBe('pickup');
    expect(parseDeliveryChoice('parcel')).toBeNull();
    expect(parseDeliveryChoice(null)).toBeNull();
  });

  it('isOfferAttributeKey recognises only the keys this module owns', () => {
    expect(isOfferAttributeKey('delivery_choice')).toBe(true);
    expect(isOfferAttributeKey('offer_declined_protection')).toBe(true);
    expect(isOfferAttributeKey('offer_declined_other')).toBe(false);
    expect(isOfferAttributeKey('note')).toBe(false);
    expect(isOfferAttributeKey(undefined)).toBe(false);
  });
});
