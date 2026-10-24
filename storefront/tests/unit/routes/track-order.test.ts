import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  GUEST_LOOKUP_FAILURE_MESSAGE,
  type GuestOrderCandidate,
} from '~/lib/orders/guest-lookup';
import {
  GUEST_LOOKUP_UNAVAILABLE_MESSAGE,
  resetGuestLookupStateForTests,
} from '~/lib/orders/guest-lookup-handler';
import {action, headers, loader, meta} from '~/routes/track-order';
import {FIXTURE_NOW, fixtureOrder} from '../orders/fake-admin-client';

// REQ-ACC-003 / P6-08 / T-09: the real loader and action against a stubbed network layer (the global fetch), so
// the Admin client, handler, limiter and route wiring all run. UNVERIFIED against a real store (V-20). Timers are
// fake because the response floor would otherwise cost real time in every test.

const ORIGIN = 'https://shop.example';
const TOKEN = 'fixture-admin-token-not-real';
const CONFIGURED = {
  PUBLIC_STORE_DOMAIN: 'test-shop.myshopify.com',
  SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN,
  TRUSTED_CLIENT_IP_HEADER: 'x-real-ip',
};
const UNCONFIGURED = {TRUSTED_CLIENT_IP_HEADER: 'x-real-ip'};
const RIGHT = {orderNumber: '#1001', email: 'shopper@example.com'};

type AdminCall = {url: string; headers: Headers; body: unknown};

function adminNode(order: GuestOrderCandidate) {
  return {
    name: order.name,
    email: order.email,
    createdAt: order.createdAt,
    cancelledAt: order.cancelledAt,
    displayFulfillmentStatus: order.displayFulfillmentStatus,
    lineItems: {nodes: order.lineItems},
    fulfillments: order.fulfillments.map((f) => ({
      displayStatus: f.displayStatus,
      trackingInfo: f.tracking,
    })),
  };
}

/** Stubs the network: every call is recorded and answered with `orders`. */
function stubAdminApi(
  orders: GuestOrderCandidate[],
  status = 200,
): AdminCall[] {
  const calls: AdminCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body)) as unknown,
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({data: {orders: {nodes: orders.map(adminNode)}}}),
          {status},
        ),
      );
    }),
  );
  return calls;
}

let ipCounter = 0;
/** A new documentation-range address per call, so tests do not share the per-instance counters. */
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

function postRequest(
  fields: Record<string, string>,
  ip: string = nextIp(),
  extra: Record<string, string> = {},
): Request {
  return new Request(`${ORIGIN}/track-order`, {
    method: 'POST',
    headers: {Origin: ORIGIN, 'x-real-ip': ip, ...extra},
    body: new URLSearchParams(fields),
  });
}

function args(request: Request, env: object) {
  return {request, context: {env}, params: {}} as never;
}

type Wrapped = {
  data: Record<string, unknown>;
  status: number;
  headers: Headers;
};

function unwrap(result: unknown): Wrapped {
  if (
    typeof result === 'object' &&
    result !== null &&
    'data' in result &&
    'init' in result
  ) {
    const {data, init} = result;
    const record = typeof init === 'object' && init !== null ? init : {};
    return {
      data: Object.fromEntries(
        Object.entries(typeof data === 'object' && data !== null ? data : {}),
      ),
      status: 'status' in record ? Number(record.status) : 200,
      headers: new Headers(
        'headers' in record ? (record.headers as HeadersInit) : undefined,
      ),
    };
  }
  throw new Error('Not a data() result');
}

/** Runs the action while the fake clock lets the response floor pass. */
async function runAction(request: Request, env: object): Promise<Wrapped> {
  let settled = false;
  const pending = action(args(request, env)).finally(() => {
    settled = true;
  });
  // Web Crypto (the key hasher) completes on the real event loop, so the response-floor timer may not exist yet:
  // advance the fake clock, then yield to the real loop, until the action has finished.
  for (let turn = 0; turn < 200 && !settled; turn += 1) {
    await vi.advanceTimersByTimeAsync(1000);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return unwrap(await pending);
}

beforeEach(() => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
  vi.setSystemTime(FIXTURE_NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetGuestLookupStateForTests();
});

describe('GET /track-order (REQ-ACC-003)', () => {
  it('shows the form when configured and the unavailable notice when not, with no data from the URL', () => {
    const calls = stubAdminApi([fixtureOrder()]);
    const request = new Request(
      `${ORIGIN}/track-order?orderNumber=1001&email=shopper%40example.com`,
      {headers: {'x-real-ip': nextIp()}},
    );
    const ready = unwrap(loader(args(request, CONFIGURED)));
    expect(ready.data).toEqual({available: true});
    expect(unwrap(loader(args(request, UNCONFIGURED))).data).toEqual({
      available: false,
    });
    // A GET never looks anything up and nothing from the query string reaches the page data.
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(ready.data)).not.toContain('1001');
    expect(JSON.stringify(ready.data)).not.toContain('shopper');
  });

  it('is private, uncached and not indexable', () => {
    const result = unwrap(
      loader(args(new Request(`${ORIGIN}/track-order`), CONFIGURED)),
    );
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    const documentHeaders = headers({
      actionHeaders: new Headers({'Retry-After': '30'}),
      loaderHeaders: result.headers,
    } as never) as Headers;
    expect(documentHeaders.get('Cache-Control')).toBe('private, no-store');
    expect(documentHeaders.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(documentHeaders.get('Retry-After')).toBe('30');
    const tags = meta({} as never);
    expect(tags).toContainEqual({name: 'robots', content: 'noindex, nofollow'});
  });
});

describe('POST /track-order without the Admin token (fail closed)', () => {
  it('says the lookup is unavailable and calls nothing', async () => {
    const calls = stubAdminApi([fixtureOrder()]);
    const result = await runAction(postRequest(RIGHT), UNCONFIGURED);
    expect(result.status).toBe(503);
    expect(result.data).toEqual({
      status: 'unavailable',
      message: GUEST_LOOKUP_UNAVAILABLE_MESSAGE,
    });
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(calls).toHaveLength(0);
  });
});

describe('POST /track-order with a stubbed Admin API (REQ-ACC-003)', () => {
  it('returns the order for the matching number and email, using the token only in the header', async () => {
    const calls = stubAdminApi([fixtureOrder()]);
    const result = await runAction(postRequest(RIGHT), CONFIGURED);
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({
      status: 'found',
      order: {orderName: '#1001', statusLabel: 'Fulfilled'},
    });
    expect(JSON.stringify(result.data).toLowerCase()).not.toContain(
      'shopper@example.com',
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://test-shop.myshopify.com/admin/api/2026-10/graphql.json',
    );
    expect(calls[0]?.headers.get('X-Shopify-Access-Token')).toBe(TOKEN);
    expect(JSON.stringify(calls[0]?.body)).not.toContain(TOKEN);
    expect(calls[0]?.body).toMatchObject({variables: {query: 'name:1001'}});
    expect(JSON.stringify(result.data)).not.toContain(TOKEN);
  });

  it('answers a wrong email, an unknown order and a 60+ day order with the same response', async () => {
    const old = fixtureOrder({
      createdAt: new Date(FIXTURE_NOW - 75 * 86_400_000).toISOString(),
    });
    stubAdminApi([fixtureOrder()]);
    const wrongEmail = await runAction(
      postRequest({orderNumber: '#1001', email: 'other@example.com'}),
      CONFIGURED,
    );
    stubAdminApi([]);
    const unknown = await runAction(postRequest(RIGHT), CONFIGURED);
    stubAdminApi([old]);
    const tooOld = await runAction(postRequest(RIGHT), CONFIGURED);
    stubAdminApi([fixtureOrder()]);
    const malformed = await runAction(
      postRequest({orderNumber: '1001; DROP', email: 'x'}),
      CONFIGURED,
    );

    const expected = {
      status: 200,
      data: {status: 'not_found', message: GUEST_LOOKUP_FAILURE_MESSAGE},
    };
    for (const result of [wrongEmail, unknown, tooOld, malformed]) {
      expect({status: result.status, data: result.data}).toEqual(expected);
      expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    }
  });

  it('answers an Admin API outage with the same generic response', async () => {
    stubAdminApi([], 503);
    const result = await runAction(postRequest(RIGHT), CONFIGURED);
    expect({status: result.status, data: result.data}).toEqual({
      status: 200,
      data: {status: 'not_found', message: GUEST_LOOKUP_FAILURE_MESSAGE},
    });
  });

  it('refuses a cross-origin POST without calling the Admin API', async () => {
    const calls = stubAdminApi([fixtureOrder()]);
    const result = await runAction(
      postRequest(RIGHT, nextIp(), {Origin: 'https://evil.example'}),
      CONFIGURED,
    );
    expect(result.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('refuses a non-POST method reaching the action', async () => {
    const calls = stubAdminApi([fixtureOrder()]);
    const request = new Request(`${ORIGIN}/track-order`, {
      method: 'PUT',
      headers: {Origin: ORIGIN, 'x-real-ip': nextIp()},
    });
    const result = await runAction(request, CONFIGURED);
    expect(result.status).toBe(405);
    expect(result.headers.get('Allow')).toBe('POST');
    expect(calls).toHaveLength(0);
  });

  it('rate limits the same order from the same address (429, Retry-After, no more upstream calls)', async () => {
    const calls = stubAdminApi([fixtureOrder()]);
    const ip = nextIp();
    const wrong = {orderNumber: '#1001', email: 'other@example.com'};
    for (let i = 0; i < 3; i += 1) {
      expect((await runAction(postRequest(wrong, ip), CONFIGURED)).status).toBe(
        200,
      );
    }
    const blocked = await runAction(postRequest(wrong, ip), CONFIGURED);
    expect(blocked.status).toBe(429);
    expect(blocked.data.status).toBe('rate_limited');
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(calls).toHaveLength(3);
    // A different address is not affected.
    expect(
      (await runAction(postRequest(wrong, nextIp()), CONFIGURED)).status,
    ).toBe(200);
  });

  it('logs no order number, email or address', async () => {
    const lines: string[] = [];
    const sink = (line: unknown) => {
      lines.push(String(line));
    };
    vi.spyOn(console, 'warn').mockImplementation(sink);
    vi.spyOn(console, 'error').mockImplementation(sink);
    stubAdminApi([fixtureOrder()]);
    const ip = nextIp();
    await runAction(postRequest(RIGHT, ip), CONFIGURED);
    await runAction(
      postRequest({orderNumber: '#77665544', email: 'nobody@example.org'}, ip),
      CONFIGURED,
    );
    const text = lines.join('\n');
    expect(text).toContain('guest_lookup.completed');
    for (const secret of ['1001', '77665544', 'shopper', 'nobody', ip, TOKEN]) {
      expect(text).not.toContain(secret);
    }
  });
});
