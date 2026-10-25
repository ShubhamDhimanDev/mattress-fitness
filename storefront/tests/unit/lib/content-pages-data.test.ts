import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {
  CONTENT_BLOGS,
  CONTENT_PAGES,
  NO_CONTENT,
} from '~/lib/pages/content-pages';
import {
  AVAILABILITY_BACKOFF_MS,
  AVAILABILITY_FRESH_MS,
  AVAILABILITY_MAX_STALE_MS,
  AVAILABILITY_TIMEOUT_MS,
  CONTENT_PAGES_QUERY,
  availabilityFrom,
  loadContentAvailability,
  loadFooterPageLinks,
  resetContentPagesLogMemory,
} from '~/lib/shopify/content-pages-data';

// REQ-CNT-001: one cached batched read tells the links which pages exist; it never rejects.

function answer(
  bodies: Record<string, string | null> = {},
  extra: Record<string, unknown> = {},
) {
  const data: Record<string, unknown> = {
    blog0: null,
    shop: {privacyPolicy: null, termsOfService: null},
    ...extra,
  };
  CONTENT_PAGES.forEach((page, index) => {
    const body = bodies[page.handle];
    data[`page${index}`] = body === undefined || body === null ? null : {body};
  });
  return data;
}

const JOURNAL = {handle: 'journal', articles: {nodes: [{id: 'gid://a/1'}]}};

beforeEach(() => resetContentPagesLogMemory());
afterEach(() => vi.restoreAllMocks());

describe('REQ-CNT-001 the batched query', () => {
  it('asks for every registry page by its handle under a numbered alias, in registry order', () => {
    const asked = [
      ...CONTENT_PAGES_QUERY.matchAll(/page(\d+): page\(handle: "([^"]+)"\)/g),
    ].map((match) => [Number(match[1]), match[2]]);
    expect(asked).toEqual(
      CONTENT_PAGES.map((page, index) => [index, page.handle]),
    );
  });

  it('asks for the journal blog by its registry handle and the two policies', () => {
    const blogs = [
      ...CONTENT_PAGES_QUERY.matchAll(/blog(\d+): blog\(handle: "([^"]+)"\)/g),
    ].map((match) => [Number(match[1]), match[2]]);
    expect(blogs).toEqual(
      CONTENT_BLOGS.map((blog, index) => [index, blog.handle]),
    );
    expect(CONTENT_PAGES_QUERY).toContain('privacyPolicy');
    expect(CONTENT_PAGES_QUERY).toContain('termsOfService');
  });

  it('reads the body, so a page counts by the same rule the page route uses', () => {
    expect(CONTENT_PAGES_QUERY).toMatch(/\{ body \}/);
    expect(CONTENT_PAGES_QUERY).not.toContain('bodySummary');
  });

  it('asks for one article of the journal, to know the blog is not empty', () => {
    expect(CONTENT_PAGES_QUERY).toMatch(/articles\(first: 1\)/);
  });
});

describe('REQ-CNT-001 availabilityFrom', () => {
  it('counts a page with text, and not one that is missing or blank', () => {
    const result = availabilityFrom(
      // The generated type allows only the queried fields; the answer is shaped like Shopify's.
      answer({faq: '<p>Questions</p>', contact: '   ', about: ''}) as never,
    );
    expect([...result.pages]).toEqual(['faq']);
  });

  it('does not count a page whose only content is non-breaking spaces or empty markup', () => {
    const result = availabilityFrom(
      answer({
        contact: '<p>&nbsp;</p><p>&#160;</p><p>  </p>',
        about: '<p><br></p><div> </div>',
        faq: '<script>alert(1)</script>',
      }) as never,
    );
    expect(result.pages.size).toBe(0);
  });

  it('counts an image-only page, but not an image the sanitiser refuses', () => {
    const result = availabilityFrom(
      answer({
        about: '<img src="https://cdn.shopify.com/a.png" alt="">',
        contact: '<img src="javascript:alert(1)">',
        faq: '<img>',
      }) as never,
    );
    expect([...result.pages]).toEqual(['about']);
  });

  it('counts the policies and the journal blog that exist', () => {
    const result = availabilityFrom(
      answer(
        {},
        {
          blog0: JOURNAL,
          shop: {privacyPolicy: {id: 'p'}, termsOfService: null},
        },
      ) as never,
    );
    expect([...result.policies]).toEqual(['privacyPolicy']);
    expect([...result.blogs]).toEqual(['journal']);
  });

  it('does not count a blog with no articles', () => {
    expect(
      availabilityFrom(
        answer(
          {},
          {blog0: {handle: 'journal', articles: {nodes: []}}},
        ) as never,
      ).blogs.size,
    ).toBe(0);
    expect(
      availabilityFrom(answer({}, {blog0: {handle: 'journal'}}) as never).blogs
        .size,
    ).toBe(0);
  });

  it('does not trust a blog whose handle differs', () => {
    expect(
      availabilityFrom(
        answer({}, {blog0: {...JOURNAL, handle: 'other'}}) as never,
      ).blogs.size,
    ).toBe(0);
  });

  it.each([null, undefined, {}, {shop: null}, {page0: 'text', shop: 'x'}])(
    'treats %j as nothing existing',
    (data) => {
      const result = availabilityFrom(data as never);
      expect(result.pages.size).toBe(0);
      expect(result.policies.size).toBe(0);
      expect(result.blogs.size).toBe(0);
    },
  );
});

describe('REQ-CNT-001 loadContentAvailability and loadFooterPageLinks', () => {
  it('makes one request with the long catalog cache and no shopper data', async () => {
    const {storefront, calls} = fakeStorefront(() =>
      answer({faq: '<p>Questions</p>'}),
    );
    const links = await loadFooterPageLinks(storefront);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cache).toEqual({mode: 'long'});
    expect(calls[0]?.variables).toEqual({});
    expect(links.map((link) => link.to)).toEqual(['/pages/faq']);
  });

  it('gives no links, and no exception, when the read fails, and logs the failure once', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const {storefront} = fakeStorefront(() => {
      throw new Error('boom: customer@example.com');
    });
    expect(await loadFooterPageLinks(storefront)).toEqual([]);
    expect(await loadFooterPageLinks(storefront)).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toContain('content.pages_read_failed');
    expect(line).not.toContain('customer@example.com');
  });

  it('logs again when a failure follows a success', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const {storefront} = fakeStorefront(() => {
      if (fail) throw new Error('down');
      return answer();
    });
    await loadContentAvailability(storefront, 0);
    fail = false;
    await loadContentAvailability(storefront, AVAILABILITY_BACKOFF_MS + 1);
    fail = true;
    await loadContentAvailability(
      storefront,
      AVAILABILITY_BACKOFF_MS + 1 + AVAILABILITY_FRESH_MS,
    );
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('shows no links for a shop with no pages, policies or blog', async () => {
    const {storefront} = fakeStorefront(() => answer());
    expect(await loadFooterPageLinks(storefront)).toEqual([]);
  });
});

describe('REQ-CNT-001 the remembered answer in front of the Storefront cache (security C-M2)', () => {
  const FRESH = AVAILABILITY_FRESH_MS;

  it('asks Shopify once per fresh window, however many requests arrive', async () => {
    const {storefront, calls} = fakeStorefront(() => answer({faq: '<p>Q</p>'}));
    for (let i = 0; i < 25; i += 1) {
      await loadFooterPageLinks(storefront, i * 1_000);
    }
    expect(calls).toHaveLength(1);
    await loadFooterPageLinks(storefront, FRESH + 1);
    expect(calls).toHaveLength(2);
  });

  it('shares one read between requests that arrive together', async () => {
    const {storefront, calls} = fakeStorefront(() => answer({faq: '<p>Q</p>'}));
    const all = await Promise.all(
      Array.from({length: 10}, () => loadContentAvailability(storefront, 0)),
    );
    expect(calls).toHaveLength(1);
    expect(all.every((value) => value.pages.has('faq'))).toBe(true);
  });

  it('keeps only derived answers: handles, never page text', async () => {
    const body = '<p>SECRET-BODY-TEXT</p>';
    const {storefront} = fakeStorefront(() => answer({faq: body}));
    const value = await loadContentAvailability(storefront, 0);
    expect(
      JSON.stringify([...value.pages, ...value.policies, ...value.blogs]),
    ).not.toContain('SECRET');
  });

  it('keeps serving the last good answer when a refresh fails, then drops it after the stale limit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = false;
    const {storefront, calls} = fakeStorefront(() => {
      if (fail) throw new Error('down');
      return answer({faq: '<p>Q</p>'});
    });
    await loadContentAvailability(storefront, 0);
    fail = true;
    const stale = await loadContentAvailability(storefront, FRESH + 1);
    expect(stale.pages.has('faq')).toBe(true);
    expect(calls).toHaveLength(2);
    const gone = await loadContentAvailability(
      storefront,
      AVAILABILITY_MAX_STALE_MS + 1,
    );
    expect(gone.pages.size).toBe(0);
  });

  it('retries the next request after a failure with nothing remembered', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const {storefront, calls} = fakeStorefront(() => {
      if (fail) throw new Error('down');
      return answer({faq: '<p>Q</p>'});
    });
    expect((await loadContentAvailability(storefront, 0)).pages.size).toBe(0);
    fail = false;
    expect(
      (
        await loadContentAvailability(storefront, AVAILABILITY_BACKOFF_MS + 1)
      ).pages.has('faq'),
    ).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

describe('REQ-CNT-001 a slow or failing Shopify costs a page nothing (security RR-L2, RR-L3)', () => {
  afterEach(() => vi.useRealTimers());

  it('stops waiting after the timeout and serves the last good answer, without cancelling the read', async () => {
    vi.useFakeTimers();
    let release: (value: unknown) => void = () => {};
    let slow = false;
    const {storefront, calls} = fakeStorefront(() =>
      slow
        ? new Promise((resolve) => {
            release = resolve;
          })
        : answer({faq: '<p>Q</p>'}),
    );
    await loadContentAvailability(storefront, 0);
    slow = true;
    const waiting = loadContentAvailability(
      storefront,
      AVAILABILITY_FRESH_MS + 1,
    );
    await vi.advanceTimersByTimeAsync(AVAILABILITY_TIMEOUT_MS);
    const served = await waiting;
    expect(served.pages.has('faq')).toBe(true);
    // The read is still running; when it finishes, the next request has the new answer.
    release(answer({about: '<p>About</p>'}));
    await vi.advanceTimersByTimeAsync(0);
    const later = await loadContentAvailability(
      storefront,
      AVAILABILITY_FRESH_MS + 2_000,
    );
    expect([...later.pages]).toEqual(['about']);
    expect(calls).toHaveLength(2);
  });

  it('serves nothing, after the timeout, when there is no earlier answer', async () => {
    vi.useFakeTimers();
    const {storefront} = fakeStorefront(() => new Promise(() => {}));
    const waiting = loadContentAvailability(storefront, 0);
    await vi.advanceTimersByTimeAsync(AVAILABILITY_TIMEOUT_MS);
    expect((await waiting).pages.size).toBe(0);
  });

  it('does not make the next request wait after a timeout: it backs off for 15 seconds', async () => {
    vi.useFakeTimers();
    const {storefront, calls} = fakeStorefront(() => new Promise(() => {}));
    const first = loadContentAvailability(storefront, 0);
    await vi.advanceTimersByTimeAsync(AVAILABILITY_TIMEOUT_MS);
    await first;
    // Inside the back-off the answer is immediate (no timer to advance) and no new read is started.
    const second = await loadContentAvailability(storefront, 5_000);
    expect(second.pages.size).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('does not retry a failed read for 15 seconds, serving the last answer meanwhile', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = false;
    const {storefront, calls} = fakeStorefront(() => {
      if (fail) throw new Error('down');
      return answer({faq: '<p>Q</p>'});
    });
    await loadContentAvailability(storefront, 0);
    fail = true;
    const at = AVAILABILITY_FRESH_MS + 1;
    expect(
      (await loadContentAvailability(storefront, at)).pages.has('faq'),
    ).toBe(true);
    expect(calls).toHaveLength(2);
    for (const offset of [1, 5_000, AVAILABILITY_BACKOFF_MS - 1]) {
      const served = await loadContentAvailability(storefront, at + offset);
      expect(served.pages.has('faq')).toBe(true);
    }
    expect(calls).toHaveLength(2);
    await loadContentAvailability(storefront, at + AVAILABILITY_BACKOFF_MS);
    expect(calls).toHaveLength(3);
  });

  it('serves nothing, not an error, inside the back-off when no answer was ever read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const {storefront, calls} = fakeStorefront(() => {
      throw new Error('down');
    });
    await loadContentAvailability(storefront, 0);
    expect((await loadContentAvailability(storefront, 10)).pages.size).toBe(0);
    expect(calls).toHaveLength(1);
  });
});

describe('REQ-CNT-001 the shared answer cannot be changed by a consumer (security RR-L4)', () => {
  it('hands out read-only sets', async () => {
    const {storefront} = fakeStorefront(() => answer({faq: '<p>Q</p>'}));
    const value = await loadContentAvailability(storefront, 0);
    expect(() => (value.pages as Set<string>).add('hacked')).toThrow(TypeError);
    expect(() => (value.pages as Set<string>).delete('faq')).toThrow(TypeError);
    expect(() => (value.pages as Set<string>).clear()).toThrow(TypeError);
    expect(Object.isFrozen(value)).toBe(true);
    expect([...value.pages]).toEqual(['faq']);
    expect(value.pages.has('faq')).toBe(true);
  });

  it('keeps the empty answer read-only too, since every failed read shares it', () => {
    expect(() => (NO_CONTENT.pages as Set<string>).add('hacked')).toThrow(
      TypeError,
    );
    expect(() => (NO_CONTENT.blogs as Set<string>).add('hacked')).toThrow(
      TypeError,
    );
    expect(Object.isFrozen(NO_CONTENT)).toBe(true);
    expect(NO_CONTENT.pages.size).toBe(0);
  });
});
