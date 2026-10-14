import {describe, expect, it} from 'vitest';
import {deliveryViewFor} from '~/lib/delivery/status';
import type {DeliveryZone} from '~/lib/delivery/zone';

// REQ-DEL-002: yes/no for the saved ZIP, client-approved wording only, nothing for an unknown zone.

const zone: DeliveryZone = {
  name: 'Chicago metro',
  postalCodes: ['606*', '60007'],
  feeCents: 14900,
  freeOverCents: 99900,
  promise: {inHome: '  White-glove delivery.  ', parcel: '', pickup: ''},
};

describe('deliveryViewFor (REQ-DEL-002)', () => {
  it('says nothing when no delivery zone is configured, even for a ZIP that looks fine', () => {
    expect(deliveryViewFor(null, '60601')).toEqual({status: 'unavailable'});
    expect(deliveryViewFor(null, null)).toEqual({status: 'unavailable'});
  });

  it.each([
    null,
    undefined,
    '',
    '  ',
    '6060',
    'abcde',
    60601,
    {},
    '60601; DROP',
  ])('reads %j as "no ZIP", never as a yes', (zip) => {
    expect(deliveryViewFor(zone, zip)).toEqual({status: 'no-zip'});
  });

  it('is a yes with the approved wording, trimmed, for a ZIP inside the zone', () => {
    expect(deliveryViewFor(zone, '60645')).toEqual({
      status: 'in-zone',
      zip: '60645',
      promise: 'White-glove delivery.',
    });
    expect(deliveryViewFor(zone, '60007')).toMatchObject({status: 'in-zone'});
  });

  it('reduces ZIP+4 to the 5-digit code', () => {
    expect(deliveryViewFor(zone, '60645-1234')).toMatchObject({
      status: 'in-zone',
      zip: '60645',
    });
  });

  it('is a no, with no promise text, for a ZIP outside the zone', () => {
    const view = deliveryViewFor(zone, '90210');
    expect(view).toEqual({status: 'outside-zone', zip: '90210'});
    expect(JSON.stringify(view)).not.toMatch(/White-glove/);
  });

  it('shows no promise line when the client has supplied no wording (never invented)', () => {
    const silent = {...zone, promise: {inHome: ' ', parcel: '', pickup: ''}};
    expect(deliveryViewFor(silent, '60645')).toEqual({
      status: 'in-zone',
      zip: '60645',
      promise: null,
    });
  });

  it('keeps the zone boundary exact', () => {
    expect(deliveryViewFor(zone, '60599').status).toBe('outside-zone');
    expect(deliveryViewFor(zone, '60600').status).toBe('in-zone');
    expect(deliveryViewFor(zone, '60699').status).toBe('in-zone');
    expect(deliveryViewFor(zone, '60700').status).toBe('outside-zone');
  });
});
