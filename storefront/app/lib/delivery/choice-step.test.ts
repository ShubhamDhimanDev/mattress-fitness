import {describe, expect, it} from 'vitest';
import {
  deliveryChoiceState,
  mayChoose,
  type DeliveryChoiceInput,
} from '~/lib/delivery/choice-step';
import type {DeliveryZone} from '~/lib/delivery/zone';

// P5B-04, REQ-PRE-003: the in-home or pickup question is asked only when it can lead to a haul-away offer.

const zone: DeliveryZone = {
  name: 'Chicago metro',
  postalCodes: ['606*'],
  feeCents: 14900,
  freeOverCents: null,
  promise: {inHome: 'x', parcel: '', pickup: ''},
};

const base: DeliveryChoiceInput = {
  haulAwayOffered: true,
  zone,
  zip: '60645',
  choice: null,
};

describe('deliveryChoiceState', () => {
  it('asks for a ZIP inside the zone', () => {
    expect(deliveryChoiceState(base)).toEqual({status: 'pending'});
  });

  it('is not asked when there is no haul-away service to follow (switched off or sold out)', () => {
    expect(
      deliveryChoiceState({...base, haulAwayOffered: false}),
    ).toMatchObject({status: 'not-applicable', reason: 'not-configured'});
  });

  it('is not asked outside the zone or without a known zone', () => {
    expect(deliveryChoiceState({...base, zip: '90210'})).toMatchObject({
      status: 'not-applicable',
      reason: 'outside-zone',
    });
    expect(deliveryChoiceState({...base, zone: null})).toMatchObject({
      status: 'not-applicable',
      reason: 'zone-unavailable',
    });
  });

  it('does not ask a shopper without a ZIP (they are nudged on the product page and cart instead)', () => {
    expect(deliveryChoiceState({...base, zip: null})).toEqual({
      status: 'needs-zip',
      reason: 'zip-missing',
    });
    expect(deliveryChoiceState({...base, zip: '12'})).toEqual({
      status: 'needs-zip',
      reason: 'zip-invalid',
    });
  });

  it('is answered once a choice is recorded, whatever the ZIP says afterwards', () => {
    expect(deliveryChoiceState({...base, choice: 'pickup'})).toEqual({
      status: 'answered',
      choice: 'pickup',
    });
    expect(
      deliveryChoiceState({...base, zip: '90210', choice: 'in-home'}),
    ).toEqual({status: 'answered', choice: 'in-home'});
  });
});

describe('mayChoose (a forged answer is refused, not recorded)', () => {
  it('allows both answers for a ZIP inside the zone, including changing a recorded answer', () => {
    expect(mayChoose(base, 'in-home')).toBe(true);
    expect(mayChoose(base, 'pickup')).toBe(true);
    expect(mayChoose({...base, choice: 'pickup'}, 'in-home')).toBe(true);
  });

  it('refuses in-home outside the zone even when an answer was already recorded', () => {
    expect(mayChoose({...base, zip: '90210'}, 'in-home')).toBe(false);
    expect(
      mayChoose({...base, zip: '90210', choice: 'in-home'}, 'in-home'),
    ).toBe(false);
  });

  it('refuses both answers without a saved ZIP: that shopper is never asked the question', () => {
    expect(mayChoose({...base, zip: null}, 'in-home')).toBe(false);
    expect(mayChoose({...base, zip: null}, 'pickup')).toBe(false);
    expect(mayChoose({...base, zip: '12'}, 'pickup')).toBe(false);
  });

  it('refuses everything when the question does not apply', () => {
    expect(mayChoose({...base, haulAwayOffered: false}, 'pickup')).toBe(false);
    expect(mayChoose({...base, zone: null}, 'pickup')).toBe(false);
  });
});
