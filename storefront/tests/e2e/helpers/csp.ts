import {expect, type Locator, type Page, type Request} from '@playwright/test';
import {BLOCKED_TELEMETRY_HOST, isBlockedTelemetryRefusal} from './a11y';

// Helpers for tests/e2e/lazy-panels-production.spec.ts (P7-06 on a production build). Additive: nothing else imports
// this file. Nothing here changes what the app does; it only watches the page.

/** One `securitypolicyviolation` event as the page reported it (enforced and report-only both fire it). */
export type CspViolation = {
  disposition: string;
  violatedDirective: string;
  effectiveDirective: string;
  blockedURI: string;
  sourceFile: string;
  sample: string;
};

declare global {
  interface Window {
    __cspViolations?: CspViolation[];
  }
}

/**
 * Starts recording every CSP violation event before any page script runs. Console lines are not enough: they depend on
 * Chromium's wording, while the event names the directive and whether the policy was enforced ('enforce') or only
 * observed ('report'). Call it before the first `goto`.
 */
export async function recordCspViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations?.push({
        disposition: event.disposition,
        violatedDirective: event.violatedDirective,
        effectiveDirective: event.effectiveDirective,
        blockedURI: event.blockedURI,
        sourceFile: event.sourceFile,
        sample: event.sample,
      });
    });
  });
}

export async function readCspViolations(page: Page): Promise<CspViolation[]> {
  return page.evaluate(() => window.__cspViolations ?? []);
}

/** True only when the violation blocked a URL whose host is exactly Shopify's telemetry host (DEC-045). */
export function isTelemetryViolation(violation: CspViolation): boolean {
  try {
    const url = new URL(violation.blockedURI);
    return url.protocol === 'https:' && url.hostname === BLOCKED_TELEMETRY_HOST;
  } catch {
    return false;
  }
}

/** Violations that are not the one known telemetry refusal. A spec asserts this list is empty. */
export function unexpectedViolations(
  violations: readonly CspViolation[],
): string[] {
  return violations
    .filter((violation) => !isTelemetryViolation(violation))
    .map(
      (v) =>
        `${v.disposition} ${v.violatedDirective} blocked "${v.blockedURI}" (${v.sourceFile}) ${v.sample}`,
    );
}

export type ConsoleLine = {type: string; text: string; url: string};

/**
 * EVERY console message and uncaught page error, with no filtering at all. (The shared collectors drop the
 * telemetry refusal and the mock-store noise; this one keeps them so the spec can decide, line by line.)
 */
export function collectEveryConsoleLine(page: Page): ConsoleLine[] {
  const lines: ConsoleLine[] = [];
  page.on('console', (message) =>
    lines.push({
      type: message.type(),
      text: message.text(),
      url: message.location().url,
    }),
  );
  page.on('pageerror', (error) =>
    lines.push({type: 'pageerror', text: error.message, url: ''}),
  );
  return lines;
}

const CSP_TEXT = /content security policy|\bCSP\b|\bnonce\b|\[report only\]/i;

/** Console lines that talk about a security policy or a nonce, minus the exact known telemetry refusal. */
export function cspConsoleLines(lines: readonly ConsoleLine[]): string[] {
  return lines
    .filter((line) => CSP_TEXT.test(line.text))
    .filter((line) => !isBlockedTelemetryRefusal(line.text))
    .map((line) => `${line.type}: ${line.text}`);
}

/** How many console lines were the known telemetry refusal (recorded as evidence that the filter had work to do). */
export function telemetryRefusalCount(lines: readonly ConsoleLine[]): number {
  return lines.filter((line) => isBlockedTelemetryRefusal(line.text)).length;
}

/** The nonce the document's enforced policy carries. */
export function nonceOf(policy: string | undefined): string | null {
  const match = /'nonce-([A-Za-z0-9+/=_-]+)'/.exec(policy ?? '');
  return match?.[1] ?? null;
}

// --------------------------------------------------------------------------------------------------------------
// Network conditions (Chromium only: Chrome DevTools Protocol).
// --------------------------------------------------------------------------------------------------------------

export type NetworkProfile = {
  name: string;
  /** Round trip added to every request, ms. */
  latencyMs: number;
  /** Bytes per second, -1 for unthrottled. */
  downBytesPerSecond: number;
  upBytesPerSecond: number;
};

export const NETWORK_PROFILES = {
  unthrottled: {
    name: 'unthrottled',
    latencyMs: 0,
    downBytesPerSecond: -1,
    upBytesPerSecond: -1,
  },
  // Chrome DevTools "Fast 3G": 1.6 Mbit/s down, 750 kbit/s up, 562.5 ms round trip (DevTools applies a 0.9 factor).
  fast3g: {
    name: 'fast3g',
    latencyMs: 562.5,
    downBytesPerSecond: (1.6 * 1000 * 1000 * 0.9) / 8,
    upBytesPerSecond: (750 * 1000 * 0.9) / 8,
  },
  // "Slow 3G-like": 400 kbit/s both ways, 400 ms round trip. DevTools' own Slow 3G uses a 2 s round trip, which makes
  // a script waterfall take minutes; this keeps the shape (slow link, high latency) and a run that finishes.
  slow3g: {
    name: 'slow3g',
    latencyMs: 400,
    downBytesPerSecond: (400 * 1000) / 8,
    upBytesPerSecond: (400 * 1000) / 8,
  },
} as const satisfies Record<string, NetworkProfile>;

export type NetworkProfileName = keyof typeof NETWORK_PROFILES;

/**
 * One DevTools session for a page: switch the network profile as often as needed (a later profile replaces the
 * earlier one). The HTTP cache is left on: DevTools' cache-off switch changes how Chromium reuses preloaded modules and made a preloaded panel wait 2 s (observed), so a fresh browser context per measurement stands in for a first visit.
 * Needs Chromium.
 */
export async function networkControl(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  return {
    async apply(profile: NetworkProfile): Promise<void> {
      await session.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: profile.latencyMs,
        downloadThroughput: profile.downBytesPerSecond,
        uploadThroughput: profile.upBytesPerSecond,
      });
    },
  };
}

// --------------------------------------------------------------------------------------------------------------
// First-open timing.
// --------------------------------------------------------------------------------------------------------------

export type OpenKind = 'cart' | 'menu' | 'zip';

export type OpenMeasure = {
  /** Click to panel content ready (the cart text, the nav, the ZIP field); -1 when it never became ready. */
  readyMs: number;
  /** Click to the dialog frame being in the document. */
  dialogMs: number;
  /** The loading skeleton was in the dialog at some frame. */
  skeletonSeen: boolean;
};

/**
 * Clicks the control from inside the page (`HTMLElement.click()` fires one click and no pointer or focus event, so the
 * hover, press and focus preloads do NOT run: this is the "no preload" case) and times, with one `performance.now()`
 * clock and `requestAnimationFrame`, how long until the panel's content is in the dialog.
 */
export async function clickAndTime(
  trigger: Locator,
  kind: OpenKind,
  holdMs = 0,
): Promise<OpenMeasure> {
  return trigger.evaluate(
    (element, {panel, hold}) =>
      new Promise<{
        readyMs: number;
        dialogMs: number;
        skeletonSeen: boolean;
      }>((resolve) => {
        const SKELETON: Record<string, string> = {
          cart: 'Loading cart',
          menu: 'Loading menu',
          zip: 'Loading',
        };
        const isReady = (dialog: Element): boolean =>
          panel === 'cart'
            ? (dialog.textContent ?? '').includes('added anything yet')
            : panel === 'menu'
              ? dialog.querySelector('nav[aria-label="Mobile"]') !== null
              : dialog.querySelector('input[name="zip"]') !== null;
        let start = performance.now();
        let dialogMs = -1;
        let skeletonSeen = false;
        const run = () => {
          start = performance.now();
          (element as HTMLElement).click();
          tick();
        };
        const tick = () => {
          const elapsed = performance.now() - start;
          const dialogs = document.querySelectorAll('[role="dialog"]');
          const dialog = dialogs.item(dialogs.length - 1);
          if (dialog) {
            if (dialogMs < 0) dialogMs = elapsed;
            if (
              dialog.querySelector('[role="status"]') !== null &&
              (dialog.textContent ?? '').includes(SKELETON[panel] ?? '')
            ) {
              skeletonSeen = true;
            }
            if (isReady(dialog)) {
              resolve({readyMs: elapsed, dialogMs, skeletonSeen});
              return;
            }
          }
          if (elapsed > 45_000) {
            resolve({readyMs: -1, dialogMs, skeletonSeen});
            return;
          }
          requestAnimationFrame(tick);
        };
        if (hold > 0) {
          // A finger or pointer pressing before it releases: the press-time preload gets this long to start.
          element.dispatchEvent(
            new PointerEvent('pointerdown', {bubbles: true}),
          );
          setTimeout(run, hold);
        } else {
          run();
        }
      }),
    {panel: kind, hold: holdMs},
  );
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return Number.NaN;
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? Number.NaN)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Tracks the page's requests: which are still in flight, and every script request with its start time and encoded
 * size. `waitForLoadState('networkidle')` cannot be used to wait for a preload: it resolves at once when the page has
 * already been idle once, so a download started later is not waited for.
 */
export function watchTraffic(page: Page) {
  const inflight = new Set<Request>();
  const scripts: {request: Request; startedAt: number; bytes: number}[] = [];
  let markedAt = 0;
  page.on('request', (request) => {
    inflight.add(request);
    if (request.resourceType() === 'script') {
      scripts.push({request, startedAt: Date.now(), bytes: 0});
    }
  });
  page.on('requestfailed', (request) => inflight.delete(request));
  page.on('requestfinished', (request) => {
    inflight.delete(request);
    const entry = scripts.find((item) => item.request === request);
    if (entry) {
      void request.sizes().then(
        (sizes) => {
          entry.bytes = sizes.responseBodySize;
        },
        () => undefined,
      );
    }
  });
  return {
    /** Forget everything before now; `sinceMark` then lists the scripts started after it. */
    mark: () => {
      markedAt = Date.now();
    },
    sinceMark: () => scripts.filter((item) => item.startedAt >= markedAt),
    /** Resolves when nothing has been in flight for `quietMs`. */
    idle: async (quietMs = 500) => {
      let quietSince = Date.now();
      await expect
        .poll(
          () => {
            if (inflight.size > 0) quietSince = Date.now();
            return Date.now() - quietSince >= quietMs;
          },
          {timeout: 90_000, intervals: [50]},
        )
        .toBe(true);
    },
  };
}

/** One evidence line on the test output (the lint rule allows no `console.log`; the list reporter shows stdout). */
export function report(line: string): void {
  process.stdout.write(`${line}
`);
}
