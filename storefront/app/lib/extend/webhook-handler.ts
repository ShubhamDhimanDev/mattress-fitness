// SERVER ONLY. The Shopify webhook endpoint as a plain function over Web `Request` and `Response`, so the route file
// stays a thin shell and every path is unit-tested (P5A-08, REQ-EXT-003, T-03, security review L-1).
//
// Order of work, cheapest and least trusting first:
//   1. method, then secret configured (a missing secret answers 503 and logs the NAME of the variable only);
//   2. Content-Length over the cap is refused BEFORE any buffering, a streamed body is cut off at the cap;
//   3. HMAC over the RAW bytes, constant-time compare (webhook.ts). A bad or missing signature is 401 with NO body, so
//      an unauthenticated caller learns nothing about topics, ids or configuration;
//   4. topic, webhook id, freshness window (above Shopify's 4 hours of retries) and payload shape (webhook.ts);
//   5. answer 200 NOW and sync in the background (`schedule`, which is `waitUntil` on Oxygen). Shopify wants a 200
//      within 5 seconds and a sync with retries can take longer; failures are recovered by the reconcile script.
//
// The webhook is only a trigger: the order is read again from the Admin API and the sync is an idempotent full snapshot.
// A replayed or reordered event therefore cannot invent an order; the coalescer bounds how often one order is re-read.

import {readCappedBody} from '~/lib/extend/capped-body';
import type {ExtendLogger} from '~/lib/extend/log';
import {noopLogger} from '~/lib/extend/log';
import type {OrderCoalescer} from '~/lib/extend/order-coalescer';
import type {NowFn} from '~/lib/extend/types';
import {
  MAX_WEBHOOK_BODY_BYTES,
  receiveShopifyWebhook,
  type WebhookAction,
  type WebhookReplayStore,
} from '~/lib/extend/webhook';

/**
 * Freshness window on `X-Shopify-Triggered-At`. Shopify retries a failed delivery for about 4 hours; a retry may or may
 * not keep the original timestamp (V-20), so the window sits well above 4 hours (review L-1). The header is unsigned, so
 * this blunts naive replays only; the per-order coalescer and the idempotent PUT are the real bounds.
 */
export const WEBHOOK_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * `done`: synced or intentionally skipped (nothing to retry). `failed`: the sync did not complete, or, when `source` is
 * `detective`, there was no sync to run and the detective order read failed (logged as `detective_failed`).
 */
export type ProcessOutcome =
  {status: 'done'} | {status: 'failed'; source?: 'detective'};

function failureReason(outcome: ProcessOutcome | 'crashed'): string {
  if (outcome === 'crashed') return 'crashed';
  return outcome.status === 'failed' && outcome.source === 'detective'
    ? 'detective_failed'
    : 'sync_failed';
}

export type WebhookHandlerDeps = {
  /** SHOPIFY_APP_CLIENT_SECRET (Shopify signs app webhooks with the app's client secret, ADR-0009 addendum). */
  secret: string | null;
  replay: WebhookReplayStore;
  coalescer: OrderCoalescer<ProcessOutcome>;
  process: (action: WebhookAction) => Promise<ProcessOutcome>;
  /** `waitUntil` where the platform has one; otherwise the task simply runs on (the process is long-lived). */
  schedule: (task: Promise<unknown>) => void;
  now: NowFn;
  log?: ExtendLogger;
  maxAgeMs?: number;
  /**
   * This store's `<shop>.myshopify.com` domain (PUBLIC_STORE_DOMAIN). When both it and `X-Shopify-Shop-Domain` are present
   * and differ (compared only when this is a myshopify.com name), the event is logged at error level and ignored with a 200 (security review E-L2): a signed body from another store that
   * shares the secret must not make us read an order id that belongs to somebody else's shop.
   */
  expectedShopDomain?: string | null;
};

function normaliseShop(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/\/+$/, '');
}

/**
 * The header is compared only against a `<shop>.myshopify.com` domain. PUBLIC_STORE_DOMAIN may be a custom or a mock
 * domain (the storefront's public address), and Shopify always sends the myshopify.com name, so comparing those would
 * drop every genuine event.
 */
function isMyshopifyDomain(value: string | null | undefined): value is string {
  return (
    typeof value === 'string' && normaliseShop(value).endsWith('.myshopify.com')
  );
}

function reply(status: number, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('Cache-Control', 'no-store');
  return new Response(null, {status, headers});
}

/** Webhook bodies are capped at the library limit; see capped-body.ts. */
export function readWebhookBody(request: Request) {
  return readCappedBody(request, MAX_WEBHOOK_BODY_BYTES);
}

export async function handleShopifyWebhook(
  request: Request,
  deps: WebhookHandlerDeps,
): Promise<Response> {
  const log = deps.log ?? noopLogger;
  try {
    if (request.method !== 'POST') return reply(405, {Allow: 'POST'});
    if (deps.secret === null || deps.secret === '') {
      // A deployment fault, not a caller fault. Name only; the value is never read into a log.
      log({
        level: 'error',
        event: 'webhook.rejected',
        reason: 'not_configured:SHOPIFY_APP_CLIENT_SECRET',
      });
      return reply(503);
    }

    const body = await readWebhookBody(request);
    if (body.status === 'too_large') {
      log({
        level: 'warn',
        event: 'webhook.rejected',
        reason: 'payload_too_large',
      });
      return reply(413);
    }
    if (body.status === 'unreadable') {
      log({
        level: 'warn',
        event: 'webhook.rejected',
        reason: 'unreadable_body',
      });
      return reply(400);
    }

    const decision = await receiveShopifyWebhook({
      rawBody: body.bytes,
      headers: request.headers,
      secret: deps.secret,
      replay: deps.replay,
      now: deps.now,
      maxAgeMs: deps.maxAgeMs ?? WEBHOOK_MAX_AGE_MS,
      log,
    });
    if (decision.status === 'rejected') return reply(decision.httpStatus);
    if (decision.status === 'ignored') return reply(decision.httpStatus);

    const {action, webhookId} = decision;
    const shopHeader = request.headers.get('x-shopify-shop-domain');
    if (
      isMyshopifyDomain(deps.expectedShopDomain) &&
      shopHeader !== null &&
      normaliseShop(shopHeader) !== normaliseShop(deps.expectedShopDomain)
    ) {
      // Error level: a signed event from another shop means the secret is shared or leaked, which someone must look at
      // (review of d068db6, item D). Answered 200 so Shopify does not retry it or delete the subscription.
      log({
        level: 'error',
        event: 'webhook.ignored',
        reason: 'shop_domain_mismatch',
      });
      return reply(200);
    }
    log({
      level: 'info',
      event: 'webhook.accepted',
      orderId: action.orderId,
      reason: action.topic,
    });
    const submitted = deps.coalescer.submit(action.orderId, () =>
      deps.process(action),
    );
    if (submitted.status === 'merged') {
      log({
        level: 'info',
        event: 'webhook.coalesced',
        orderId: action.orderId,
      });
      return reply(200);
    }

    // The id is marked seen only after the sync SUCCEEDED, so a delivery that failed can still be processed when it is
    // repeated (webhook.ts, ReplayStore). A failure after the 200 is recovered by the reconcile script, not by Shopify.
    deps.schedule(
      submitted.done.then(async (outcome) => {
        if (outcome !== 'crashed' && outcome.status === 'done') {
          await deps.replay.markSeen(webhookId);
          return;
        }
        log({
          level: 'error',
          event: 'webhook.background_failed',
          orderId: action.orderId,
          reason: failureReason(outcome),
        });
      }),
    );
    return reply(200);
  } catch {
    // Anything unexpected before the 200: let Shopify retry. No detail is returned.
    log({level: 'error', event: 'webhook.rejected', reason: 'internal_error'});
    return reply(500);
  }
}
