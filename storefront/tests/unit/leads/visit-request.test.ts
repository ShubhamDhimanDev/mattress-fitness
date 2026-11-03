import {afterEach, describe, expect, it} from 'vitest';
import {createVisitCustomerClient} from '~/lib/leads/customer-client';
import {
  handleVisitRequest,
  resetVisitStateForTests,
  visitDepsFromEnv,
  type VisitDeps,
} from '~/lib/leads/visit-handler';
import {
  parseVisitForm,
  visitNote,
  visitTags,
  type VisitRequest,
} from '~/lib/leads/visit-request';
import type {FetchLike} from '~/lib/extend/types';

// CR-33 / DEC-144 / T-05 / T-13: the visit request flow with a stubbed fetch. No network. UNVERIFIED against a real
// store. Every identity is fictional (555 numbers).

afterEach(() => resetVisitStateForTests());

const GOOD = {
  budget: '1500-2499',
  visitWindow: 'within-7-days',
  name: 'Sam Rivers Jr',
  phone: '(212) 555-0100',
  zip: '10001',
};

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

const ENV = {
  PUBLIC_STORE_DOMAIN: 'demo-shop.myshopify.com',
  SHOPIFY_CUSTOMER_ADMIN_API_ACCESS_TOKEN: 'shpat_test_token',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

type Sent = {query: string; variables: Record<string, unknown>};

function stub(answers: Response[]): {fetch: FetchLike; sent: Sent[]} {
  const sent: Sent[] = [];
  const fetch: FetchLike = (_url, init) => {
    sent.push(JSON.parse(String(init.body)) as Sent);
    const next = answers.shift();
    return Promise.resolve(next ?? json({}, 500));
  };
  return {fetch, sent};
}

const SAVED = {
  data: {
    customerCreate: {
      customer: {id: 'gid://shopify/Customer/1'},
      userErrors: [],
    },
  },
};

const REQUEST: VisitRequest = {
  budget: '1500-2499',
  visitWindow: 'within-7-days',
  firstName: 'Sam',
  lastName: 'Rivers Jr',
  phone: '+12125550100',
  zip: '10001',
};

describe('parseVisitForm', () => {
  it('accepts a good form and splits the name', () => {
    expect(parseVisitForm(formOf(GOOD))).toEqual({
      status: 'ok',
      request: REQUEST,
    });
  });

  it('rejects unknown options, a bad phone and a bad ZIP with field messages', () => {
    const parsed = parseVisitForm(
      formOf({...GOOD, budget: 'free', phone: '123', zip: 'abc'}),
    );
    expect(parsed.status).toBe('invalid');
    if (parsed.status === 'invalid') {
      expect(Object.keys(parsed.errors).sort()).toEqual([
        'budget',
        'phone',
        'zip',
      ]);
    }
  });

  it('treats a filled honeypot as a bot', () => {
    expect(parseVisitForm(formOf({...GOOD, website: 'x'}))).toEqual({
      status: 'honeypot',
    });
  });

  it('builds tags and a note from allow-listed values only', () => {
    expect(visitTags(REQUEST)).toEqual([
      'visit-request',
      'visit-budget-1500-2499',
      'visit-window-within-7-days',
      'visit-zip-10001',
    ]);
    expect(visitNote(REQUEST, new Date('2026-11-03T10:00:00Z'))).toContain(
      'Budget: $1,500–$2,499',
    );
  });
});

describe('createVisitCustomerClient', () => {
  it('is null without the token or with the order-read token only', () => {
    const {fetch} = stub([]);
    expect(createVisitCustomerClient({env: {}, fetch})).toBeNull();
    expect(
      createVisitCustomerClient({
        env: {
          PUBLIC_STORE_DOMAIN: 'demo-shop.myshopify.com',
          SHOPIFY_ADMIN_API_ACCESS_TOKEN: 'shpat_orders_only',
        },
        fetch,
      }),
    ).toBeNull();
  });

  it('creates a tagged customer for a new phone number', async () => {
    const {fetch, sent} = stub([json(SAVED)]);
    const client = createVisitCustomerClient({env: ENV, fetch});
    expect(await client?.save(REQUEST)).toEqual({status: 'saved'});
    expect(sent).toHaveLength(1);
    expect(sent[0]?.variables['input']).toMatchObject({
      firstName: 'Sam',
      lastName: 'Rivers Jr',
      phone: '+12125550100',
      tags: visitTags(REQUEST),
    });
  });

  it('adds the tags to the existing customer when the phone is taken', async () => {
    const {fetch, sent} = stub([
      json({
        data: {
          customerCreate: {
            customer: null,
            userErrors: [{message: 'Phone has already been taken'}],
          },
        },
      }),
      json({data: {customers: {nodes: [{id: 'gid://shopify/Customer/9'}]}}}),
      json({data: {tagsAdd: {userErrors: []}}}),
    ]);
    const client = createVisitCustomerClient({env: ENV, fetch});
    expect(await client?.save(REQUEST)).toEqual({status: 'saved'});
    expect(sent).toHaveLength(3);
    expect(sent[2]?.variables).toEqual({
      id: 'gid://shopify/Customer/9',
      tags: visitTags(REQUEST),
    });
  });

  it('reports a refused scope as auth, and other user errors as failed', async () => {
    const denied = createVisitCustomerClient({
      env: ENV,
      fetch: stub([
        json({errors: [{message: 'x', extensions: {code: 'ACCESS_DENIED'}}]}),
      ]).fetch,
    });
    expect(await denied?.save(REQUEST)).toEqual({
      status: 'failed',
      reason: 'auth',
    });
    const refused = createVisitCustomerClient({
      env: ENV,
      fetch: stub([
        json({
          data: {
            customerCreate: {customer: null, userErrors: [{message: 'Bad'}]},
          },
        }),
      ]).fetch,
    });
    expect(await refused?.save(REQUEST)).toEqual({
      status: 'failed',
      reason: 'user_error',
    });
  });
});

describe('handleVisitRequest', () => {
  function post(
    fields: Record<string, string>,
    headers: Record<string, string> = {},
  ): Request {
    return new Request('https://shop.example/visit-request', {
      method: 'POST',
      headers: {Origin: 'https://shop.example', ...headers},
      body: new URLSearchParams(fields),
    });
  }

  function deps(answers: Response[], env: object = ENV): VisitDeps {
    return visitDepsFromEnv(env, stub(answers).fetch);
  }

  it('is unavailable (503) when the token is not configured', async () => {
    const result = await handleVisitRequest(post(GOOD), deps([], {}));
    expect(result.status).toBe(503);
    expect(result.response.status).toBe('unavailable');
  });

  it('refuses GET and cross-origin posts', async () => {
    const get = await handleVisitRequest(
      new Request('https://shop.example/visit-request'),
      deps([]),
    );
    expect(get.status).toBe(405);
    const cross = await handleVisitRequest(
      post(GOOD, {Origin: 'https://evil.example'}),
      deps([]),
    );
    expect(cross.status).toBe(403);
  });

  it('answers 422 with field errors for invalid input', async () => {
    const result = await handleVisitRequest(
      post({...GOOD, phone: 'nope'}),
      deps([]),
    );
    expect(result.status).toBe(422);
    expect(result.response.status).toBe('invalid');
  });

  it('thanks a honeypot post without calling Shopify', async () => {
    const {fetch, sent} = stub([]);
    const result = await handleVisitRequest(
      post({...GOOD, website: 'spam'}),
      visitDepsFromEnv(ENV, fetch),
    );
    expect(result.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it('saves a valid request and answers ok; a failed save is a friendly 503', async () => {
    const ok = await handleVisitRequest(post(GOOD), deps([json(SAVED)]));
    expect(ok.status).toBe(200);
    expect(ok.response.status).toBe('ok');
    const failed = await handleVisitRequest(post(GOOD), deps([json({}, 500)]));
    expect(failed.status).toBe(503);
  });

  it('rate limits one phone number after two requests a day', async () => {
    const d = deps([json(SAVED), json(SAVED), json(SAVED)]);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await handleVisitRequest(post(GOOD), d)).status);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });
});
