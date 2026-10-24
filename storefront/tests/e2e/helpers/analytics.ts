import {expect, type Page} from '@playwright/test';

// Shared pieces of the consent and analytics specs that came after consent.spec.ts (consent-remount.spec.ts, V-E204
// onwards). consent.spec.ts keeps its own copies of the older helpers on purpose: it is not edited to share them.
// Everything here talks to the page only; the provider hosts are answered by a stub at the network layer, so what the
// specs prove is OUR behaviour, never what Google or Meta do with an event (A-M1 stays open until a real GA4 DebugView
// and Meta Test Events check, CLR-004).

export const ANALYTICS_ON = process.env.E2E_ANALYTICS === 'on';
export const GA_ID = process.env.E2E_GA4_ID ?? 'G-TESTTEST01';
export const GA_DISABLE_FLAG = `ga-disable-${GA_ID}`;
export const GA_HOST = /^https:\/\/www\.googletagmanager\.com\//;
export const META_HOST = /^https:\/\/connect\.facebook\.net\//;
export const ANY_PROVIDER_HOST =
  /^https:\/\/(www\.googletagmanager\.com|connect\.facebook\.net|www\.facebook\.com|[a-z0-9-]+\.google-analytics\.com|analytics\.google\.com|[a-z0-9-]+\.analytics\.google\.com)\//;
export const CONSENT_CHUNK = /ConsentRuntime/;
const GTAG_SCRIPT = /googletagmanager\.com\/gtag\/js/;
const FBEVENTS_SCRIPT = /connect\.facebook\.net\/.*fbevents\.js/;

export const STUB_SCRIPT = {
  status: 200,
  contentType: 'application/javascript',
  body: '/* stub provider script (E2E) */',
};

/** A promise a test opens when it wants held requests to go on. */
export function createGate() {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {opened, open};
}

/**
 * Answers the provider hosts with a stub and records every request made to any provider host. With `hold`, the answer
 * waits for the gate (a provider that is slow), so a test can act while a script is still "downloading".
 */
export async function stubProviders(
  page: Page,
  options: {hold?: Promise<void>} = {},
) {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (ANY_PROVIDER_HOST.test(request.url())) requests.push(request.url());
  });
  const answer = async (route: {
    fulfill: (response: typeof STUB_SCRIPT) => Promise<void>;
  }) => {
    if (options.hold) await options.hold;
    await route.fulfill(STUB_SCRIPT);
  };
  await page.route(GA_HOST, answer);
  await page.route(META_HOST, answer);
  return requests;
}

/** Every request whose URL matches `pattern`. */
export function watchRequests(page: Page, pattern: RegExp) {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (pattern.test(request.url())) seen.push(request.url());
  });
  return seen;
}

export const requestsFor = {
  gtag: (urls: readonly string[]) =>
    urls.filter((url) => GTAG_SCRIPT.test(url)),
  fbevents: (urls: readonly string[]) =>
    urls.filter((url) => FBEVENTS_SCRIPT.test(url)),
};

export type LayerEntry = {kind: string; name: string; params: unknown};

/** `window.dataLayer` as plain data: gtag pushes `Arguments` objects (kind, name, params). */
export async function dataLayer(page: Page): Promise<LayerEntry[]> {
  return page.evaluate(() => {
    const layer: unknown = Reflect.get(window, 'dataLayer');
    if (!Array.isArray(layer)) return [];
    return layer.map((entry: unknown) => ({
      kind: String(Reflect.get(entry as object, '0')),
      name: String(Reflect.get(entry as object, '1')),
      params: JSON.parse(
        JSON.stringify(Reflect.get(entry as object, '2') ?? null),
      ) as unknown,
    }));
  });
}

export async function gaEvents(
  page: Page,
  name?: string,
): Promise<LayerEntry[]> {
  return (await dataLayer(page)).filter(
    (entry) =>
      entry.kind === 'event' && (name === undefined || entry.name === name),
  );
}

/** Every argument of every dataLayer push, as one string, to look for an address in it. */
export async function dataLayerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const layer: unknown = Reflect.get(window, 'dataLayer');
    if (!Array.isArray(layer)) return '';
    return layer
      .map((entry: unknown) =>
        JSON.stringify(Array.from(entry as ArrayLike<unknown>)),
      )
      .join('\n');
  });
}

/** Names of the `fbq(...)` calls queued by the bootstrap (the stub never replays them): "track:PageView". */
export async function metaCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fbq: unknown = Reflect.get(window, 'fbq');
    const queue: unknown = fbq ? Reflect.get(fbq as object, 'queue') : null;
    if (!Array.isArray(queue)) return [];
    return queue.map((call: unknown) => {
      const first = String(Reflect.get(call as object, '0'));
      const second = String(Reflect.get(call as object, '1'));
      return `${first}:${second}`;
    });
  });
}

/** Every argument of every queued `fbq(...)` call, as one string per call. */
export async function metaCallsText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fbq: unknown = Reflect.get(window, 'fbq');
    const queue: unknown = fbq ? Reflect.get(fbq as object, 'queue') : null;
    if (!Array.isArray(queue)) return [];
    return queue.map((call: unknown) =>
      JSON.stringify(Array.from(call as ArrayLike<unknown>)),
    );
  });
}

export async function gaDisableFlag(page: Page) {
  return page.evaluate(
    (flag) => Reflect.get(window, flag) as unknown,
    GA_DISABLE_FLAG,
  );
}

/** How many `<script src>` elements in the document match `pattern` (the source of `pattern` is matched as text). */
export async function scriptElements(page: Page, pattern: RegExp) {
  return page.evaluate(
    ({source}) =>
      Array.from(document.querySelectorAll('script[src]')).filter((script) =>
        new RegExp(source).test(script.getAttribute('src') ?? ''),
      ).length,
    {source: pattern.source},
  );
}

export const scripts = {
  gtag: (page: Page) => scriptElements(page, GTAG_SCRIPT),
  fbevents: (page: Page) => scriptElements(page, FBEVENTS_SCRIPT),
};

/**
 * A quiet period for a NEGATIVE assertion ("nothing happens"): there is no event to wait for, so the only honest form
 * is a bounded wait. Used only where the absence of a request or a push is the behaviour.
 */
export async function quietPeriod(page: Page, ms = 4000) {
  await page.evaluate(
    (wait) => new Promise<void>((resolve) => setTimeout(resolve, wait)),
    ms,
  );
}

/** The cookie the app stores the decision in (name and shape: app/lib/analytics/consent.ts). */
export async function storeDecision(
  page: Page,
  baseURL: string | undefined,
  choice: {analytics: boolean; marketing: boolean},
  decidedAtSeconds = Math.floor(Date.now() / 1000),
) {
  const stored = JSON.stringify({
    version: 1,
    ...choice,
    decidedAt: decidedAtSeconds,
  });
  await page.context().addCookies([
    {
      name: 'mf_consent',
      value: encodeURIComponent(stored),
      url: baseURL ?? '',
    },
  ]);
}

/** Cookies the providers would have set on an earlier visit (synthetic values). */
export async function plantProviderCookies(
  page: Page,
  baseURL: string | undefined,
) {
  const url = baseURL ?? '';
  await page.context().addCookies([
    {name: '_ga', value: 'GA1.1.111.222', url},
    {
      name: `_ga_${GA_ID.replace(/^G-/, '')}`,
      value: 'GS2.1.s111$o1$g0$t222$j0$l0$h0',
      url,
    },
    {name: '_fbp', value: 'fb.1.111.222', url},
    {name: '_fbc', value: 'fb.1.111.AbCdEf', url},
    // Not ours to clear: it must survive every withdrawal.
    {name: 'qa_unrelated', value: 'keep', url},
  ]);
}

export async function cookieNames(page: Page) {
  return (await page.context().cookies()).map((cookie) => cookie.name);
}

export const PROVIDER_COOKIE = /^(_ga|_ga_.*|_fbp|_fbc)$/;

/**
 * A client-side navigation (no document load) to `path`: React Router listens for popstate, so pushing the address and
 * dispatching one is the same transition a link click makes.
 */
export async function clientNavigate(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

/** A marker on `window` (not on the document): it survives the swap between the app and the error boundary. */
export async function markWindow(page: Page) {
  await page.evaluate(() => {
    Reflect.set(window, '__e2eSamePage', true);
  });
}

export async function expectSamePage(page: Page, message: string) {
  expect(
    await page.evaluate(() => Reflect.get(window, '__e2eSamePage') === true),
    message,
  ).toBe(true);
}

/**
 * Replaces `requestIdleCallback` (before any page script runs) so a test controls WHEN the page's idle work happens:
 *  - `window.__idleHold = true` holds every callback registered from then on until `window.__releaseIdle()`;
 *  - `delayMs` runs each callback that long after it was asked for (a wide, known window between "scheduled" and
 *    "loading"). Default 0.
 * It changes timing only; the product's own code and its order of work are untouched. Used to make a race
 * deterministic (a remount's gap, a scheduled provider load), never to hide one.
 */
export async function controlIdle(page: Page, delayMs = 0) {
  await page.addInitScript((delay) => {
    const queued = new Map<number, () => void>();
    let next = 1;
    Reflect.set(window, '__idleHold', false);
    window.requestIdleCallback = (callback) => {
      const id = next;
      next += 1;
      const run = () => {
        if (queued.delete(id)) {
          callback({didTimeout: false, timeRemaining: () => 0});
        }
      };
      queued.set(id, run);
      if (Reflect.get(window, '__idleHold') !== true) setTimeout(run, delay);
      return id;
    };
    window.cancelIdleCallback = (id) => {
      queued.delete(id);
    };
    Reflect.set(window, '__releaseIdle', () => {
      Reflect.set(window, '__idleHold', false);
      for (const run of [...queued.values()]) run();
    });
  }, delayMs);
}

export const banner = (page: Page) =>
  page.getByRole('region', {name: 'Privacy choices'});
// The banner arrives after hydration and browser idle (up to about 3 s on a fast machine, longer on the dev server).
export const BANNER_WAIT = {timeout: 20_000};
export const showBanner = (page: Page) =>
  expect(banner(page)).toBeVisible(BANNER_WAIT);
export const footerPrivacyButton = (page: Page) =>
  page.getByRole('button', {name: 'Privacy choices'});
