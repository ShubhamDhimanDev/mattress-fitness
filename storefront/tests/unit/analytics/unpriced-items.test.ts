import {describe, expect, it} from 'vitest';
import type {AnalyticsEvent} from '~/lib/analytics';
import {toGa4Call} from '~/lib/analytics/ga4';
import {toMetaCall} from '~/lib/analytics/meta';

// P7-01 review 2026-10-24 (nit): an item whose price cannot be written as dollars is left out of the provider payload.
// It is never sent with a made-up price of 0.

const good = {id: '1', name: 'Good', priceCents: 1000, quantity: 1};
const bad = {id: '2', name: 'Bad', priceCents: -5, quantity: 1};
const fractional = {id: '3', name: 'Half', priceCents: 10.5, quantity: 1};

const event = (
  name: 'add_to_cart' | 'view_item' | 'begin_checkout',
  items: (typeof good)[],
): AnalyticsEvent => ({name, params: {}, ecommerce: {items, valueCents: 1000}});

describe('GA4', () => {
  it('drops an item with an unusable price and keeps the others', () => {
    const call = toGa4Call(event('add_to_cart', [bad, good, fractional]));
    expect(call?.params.items).toEqual([
      {item_id: '1', item_name: 'Good', price: 10, quantity: 1},
    ]);
  });

  it('sends an empty list rather than a zero price when nothing is usable', () => {
    expect(toGa4Call(event('add_to_cart', [bad]))?.params.items).toEqual([]);
  });
});

describe('Meta', () => {
  it('leaves an unusable item out of the ids and the contents', () => {
    const call = toMetaCall(event('add_to_cart', [bad, good]));
    expect(call?.params.content_ids).toEqual(['1']);
    expect(call?.params.contents).toEqual([
      {id: '1', quantity: 1, item_price: 10},
    ]);
  });

  it('sends no event at all when no item has a usable price', () => {
    expect(toMetaCall(event('add_to_cart', [bad, fractional]))).toBeNull();
    expect(toMetaCall(event('view_item', [bad]))).toBeNull();
    expect(toMetaCall(event('begin_checkout', [bad]))).toBeNull();
  });
});
