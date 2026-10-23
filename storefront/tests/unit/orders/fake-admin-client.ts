// A typed fake of the guest-order Admin client for tests (P6-08). It makes no network call and holds no credential.
// Everything it returns is invented fixture data; example.com is reserved for documentation.

import type {
  GuestOrderCandidate,
  GuestOrderLookupRequest,
} from '~/lib/orders/guest-lookup';
import type {
  GuestOrderAdminClient,
  GuestOrderLookupResult,
} from '~/lib/orders/guest-lookup-client';

export type FakeAdminClient = GuestOrderAdminClient & {
  /** Every request the code under test made, in order. */
  readonly calls: GuestOrderLookupRequest[];
};

export function fakeAdminClient(
  respond: (
    request: GuestOrderLookupRequest,
  ) => GuestOrderLookupResult | Promise<GuestOrderLookupResult>,
): FakeAdminClient {
  const calls: GuestOrderLookupRequest[] = [];
  return {
    calls,
    async lookup(request) {
      calls.push(request);
      return respond(request);
    },
  };
}

export const FIXTURE_NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
export const FIXTURE_DAY_MS = 86_400_000;

export function fixtureOrder(
  overrides: Partial<GuestOrderCandidate> = {},
): GuestOrderCandidate {
  return {
    name: '#1001',
    email: 'Shopper@Example.com',
    createdAt: new Date(FIXTURE_NOW - 10 * FIXTURE_DAY_MS).toISOString(),
    cancelledAt: null,
    displayFulfillmentStatus: 'FULFILLED',
    lineItems: [
      {title: 'Larkmoor Cedar Medium Hybrid Mattress - Queen', quantity: 1},
    ],
    fulfillments: [
      {
        displayStatus: 'IN_TRANSIT',
        tracking: [
          {
            company: 'Example Freight',
            number: 'TRK123456789',
            url: 'https://tracking.example.com/TRK123456789',
          },
        ],
      },
    ],
    ...overrides,
  };
}
