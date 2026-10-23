import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  currentZipChange,
  deliverySignature,
  markZipChanged,
  NO_ZIP_CHANGE,
  resetZipChangeForTests,
  subscribeZipChange,
} from '~/lib/delivery-runtime/zip-change';

// P3B-11 (b): the record the cart's offers view compares against after a delivery ZIP change.

afterEach(resetZipChangeForTests);

describe('zip change record', () => {
  it('starts empty and counts each change with the cart-result sequence it was seen at', () => {
    expect(currentZipChange()).toBe(NO_ZIP_CHANGE);
    markZipChanged(3);
    expect(currentZipChange()).toEqual({epoch: 1, cartResultSeq: 3});
    markZipChanged(5);
    expect(currentZipChange()).toEqual({epoch: 2, cartResultSeq: 5});
  });

  it('tells subscribers, and stops when they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeZipChange(listener);
    markZipChanged(0);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    markZipChanged(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('deliverySignature', () => {
  it.each([
    [null, 'none'],
    [{status: 'no-zip'}, 'no-zip'],
    [{status: 'unavailable'}, 'unavailable'],
    [{status: 'service-unavailable'}, 'service-unavailable'],
    [{status: 'in-zone', zip: '60645', promise: null}, 'in-zone:60645'],
    [{status: 'outside-zone', zip: '90210'}, 'outside-zone:90210'],
  ] as const)('reads %j as %s', (view, expected) => {
    expect(deliverySignature(view)).toBe(expected);
  });

  it('is equal for the same ZIP whatever the promise text, and differs for another ZIP', () => {
    const one = deliverySignature({
      status: 'in-zone',
      zip: '60645',
      promise: 'One',
    });
    const none = deliverySignature({
      status: 'in-zone',
      zip: '60645',
      promise: null,
    });
    const other = deliverySignature({
      status: 'in-zone',
      zip: '60646',
      promise: null,
    });
    expect(one).toBe(none);
    expect(one).not.toBe(other);
  });
});
