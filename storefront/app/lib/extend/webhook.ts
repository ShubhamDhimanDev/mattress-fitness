// SERVER ONLY. Shopify webhook verification, replay protection and topic routing (REQ-EXT-003, T-03).
//
// The webhook is only a TRIGGER. The route that uses this module must read the order from the Shopify Admin API
// by id and sync that, never trust the webhook payload for order content. So a forged or replayed message can at
// worst cause an idempotent re-sync of a real order. Verification still happens first, on the raw bytes.
//
// Web Crypto only (works on Oxygen workers and Node 22).

import {normalizeShopifyId} from '~/lib/extend/ids';
import {noopLogger, type ExtendLogger} from '~/lib/extend/log';
import type {NowFn} from '~/lib/extend/types';

/** The Shopify topics this integration reacts to (REQ-EXT-003). */
export const SHOPIFY_WEBHOOK_TOPICS = [
  'orders/paid',
  'orders/updated',
  'orders/cancelled',
  'refunds/create',
  'fulfillments/create',
] as const;
export type ShopifyWebhookTopic = (typeof SHOPIFY_WEBHOOK_TOPICS)[number];

export type WebhookIntent =
  'report' | 'update' | 'cancel' | 'refund' | 'fulfil';

export type WebhookAction = {
  type: 'sync_order';
  orderId: string;
  topic: ShopifyWebhookTopic;
  intent: WebhookIntent;
};

/** Also enforced by the route on Content-Length BEFORE the body is buffered (security review L-1). */
export const MAX_WEBHOOK_BODY_BYTES = 5 * 1024 * 1024;
const DEFAULT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();

export type RawBody = string | ArrayBuffer | Uint8Array;

function toBytes(body: RawBody): Uint8Array<ArrayBuffer> {
  if (typeof body === 'string') return encoder.encode(body);
  // Copies, so the caller's buffer cannot change under us between verifying and parsing.
  return new Uint8Array(body);
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Compares without exiting early on the first differing byte, and without leaking which byte differed. */
function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

async function hmacSha256Base64(
  bytes: Uint8Array<ArrayBuffer>,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['sign'],
  );
  return base64(new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes)));
}

/**
 * Verifies `X-Shopify-Hmac-Sha256` against the RAW request body (not re-serialised JSON). Returns false for a
 * missing, truncated or wrong header, a wrong secret, a tampered body or an empty secret (fail closed).
 */
export async function verifyShopifyWebhook(
  rawBody: RawBody,
  hmacHeader: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (secret === '' || typeof hmacHeader !== 'string' || hmacHeader === '') {
    return false;
  }
  try {
    const expected = await hmacSha256Base64(toBytes(rawBody), secret);
    return constantTimeEqual(expected, hmacHeader);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ replay store

/**
 * `seen` answers "was this webhook id already processed successfully?". The route calls `markSeen` only AFTER
 * processing succeeded: Shopify retries a failed delivery with the same webhook id, and marking it earlier would
 * turn a transient failure into a lost event. Production needs a durable store (for example KV); the in-memory
 * one below is for tests and local development only.
 */
export type WebhookReplayStore = {
  seen: (webhookId: string) => Promise<boolean> | boolean;
  markSeen: (webhookId: string) => Promise<void> | void;
};

export function createMemoryReplayStore(options: {
  now: NowFn;
  ttlMs?: number;
  maxEntries?: number;
}): WebhookReplayStore {
  const ttlMs = options.ttlMs ?? 3 * 24 * 60 * 60 * 1000;
  const maxEntries = options.maxEntries ?? 10_000;
  const entries = new Map<string, number>();

  return {
    seen(webhookId) {
      const markedAt = entries.get(webhookId);
      if (markedAt === undefined) return false;
      if (options.now() - markedAt > ttlMs) {
        entries.delete(webhookId);
        return false;
      }
      return true;
    },
    markSeen(webhookId) {
      entries.delete(webhookId);
      entries.set(webhookId, options.now());
      // Map keeps insertion order, so the first key is the oldest.
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
  };
}

// ------------------------------------------------------------------ router

const INTENT: Record<ShopifyWebhookTopic, WebhookIntent> = {
  'orders/paid': 'report',
  'orders/updated': 'update',
  'orders/cancelled': 'cancel',
  'refunds/create': 'refund',
  'fulfillments/create': 'fulfil',
};

export function isSupportedTopic(topic: string): topic is ShopifyWebhookTopic {
  return SHOPIFY_WEBHOOK_TOPICS.some((supported) => supported === topic);
}

export type RouteResult =
  | {status: 'ok'; action: WebhookAction}
  | {status: 'error'; reason: 'unsupported_topic' | 'malformed_payload'};

/**
 * Maps a topic and its (already verified) payload to the action to take. Every supported topic leads to the
 * same thing, a fresh read and full-snapshot sync of the order, because the snapshot already encodes paid,
 * fulfilled, refunded and cancelled state.
 * ASSUMPTION(V-20): payload field names (`id` for orders, `order_id` for refunds and fulfillments) are Shopify's
 * documented webhook shapes; confirm on the development store.
 */
export function routeShopifyTopic(
  topic: string,
  payload: unknown,
): RouteResult {
  const normalised = topic.trim().toLowerCase();
  if (!isSupportedTopic(normalised)) {
    return {status: 'error', reason: 'unsupported_topic'};
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return {status: 'error', reason: 'malformed_payload'};
  }
  // The id is read from the SIGNED body by its shape, not by the unsigned Topic header (security review E-L2): a refund or
  // fulfilment payload carries `order_id`, and that wins whatever the header claims, so a relabelled body can never make
  // the refund's own id be read as an order id. Only a body with no `order_id` is read as an order, and only for an
  // orders/* topic.
  const fields = Object.fromEntries(Object.entries(payload));
  const orderRef: unknown = fields['order_id'];
  const raw: unknown =
    orderRef !== undefined
      ? orderRef
      : normalised.startsWith('orders/')
        ? fields['id']
        : undefined;
  const orderId =
    typeof raw === 'string' || typeof raw === 'number'
      ? normalizeShopifyId(raw)
      : null;
  if (orderId === null) return {status: 'error', reason: 'malformed_payload'};
  return {
    status: 'ok',
    action: {
      type: 'sync_order',
      orderId,
      topic: normalised,
      intent: INTENT[normalised],
    },
  };
}

// ---------------------------------------------------------------- receiver

export type WebhookInput = {
  rawBody: RawBody;
  /** A Web `Headers` object (or anything with `get`). */
  headers: {get: (name: string) => string | null};
  secret: string;
  replay: WebhookReplayStore;
  now: NowFn;
  /**
   * Optional replay window on `X-Shopify-Triggered-At`. Shopify documents 8 retries over 4 hours for a failed
   * delivery (shopify.dev, "Deliver webhooks through HTTPS", read 2026-10-12); whether a retry keeps the original
   * timestamp is not stated (ASSUMPTION(V-20)), so a window shorter than a few hours could drop legitimate retries.
   * Leave it off or set it well above 4 hours. The sync is idempotent and re-reads the order, so the window is
   * defence in depth, not the main control. Shopify does not guarantee delivery order, which is why the webhook
   * only triggers a fresh read instead of carrying state.
   */
  maxAgeMs?: number;
  maxFutureSkewMs?: number;
  log?: ExtendLogger;
};

export type WebhookDecision =
  | {status: 'accepted'; webhookId: string; action: WebhookAction}
  | {
      status: 'ignored';
      reason: 'replayed' | 'stale' | 'unsupported_topic';
      /** Acknowledge with 200 so Shopify stops retrying; there is nothing to process. */
      httpStatus: 200;
    }
  | {
      status: 'rejected';
      reason:
        | 'bad_signature'
        | 'payload_too_large'
        | 'missing_webhook_id'
        | 'invalid_timestamp'
        | 'malformed_payload';
      httpStatus: 400 | 401 | 413;
    };

export async function receiveShopifyWebhook(
  input: WebhookInput,
): Promise<WebhookDecision> {
  const log = input.log ?? noopLogger;
  const reject = (
    reason: Extract<WebhookDecision, {status: 'rejected'}>['reason'],
    httpStatus: 400 | 401 | 413,
  ): WebhookDecision => {
    log({level: 'warn', event: 'webhook.rejected', reason});
    return {status: 'rejected', reason, httpStatus};
  };
  const ignore = (
    reason: Extract<WebhookDecision, {status: 'ignored'}>['reason'],
  ): WebhookDecision => {
    log({level: 'info', event: 'webhook.ignored', reason});
    return {status: 'ignored', reason, httpStatus: 200};
  };

  const bytes = toBytes(input.rawBody);
  if (bytes.length > MAX_WEBHOOK_BODY_BYTES)
    return reject('payload_too_large', 413);

  // Signature first: nothing else about an unauthenticated request is examined or revealed.
  const verified = await verifyShopifyWebhook(
    bytes,
    input.headers.get('x-shopify-hmac-sha256'),
    input.secret,
  );
  if (!verified) return reject('bad_signature', 401);

  const topic = (input.headers.get('x-shopify-topic') ?? '')
    .trim()
    .toLowerCase();
  if (!isSupportedTopic(topic)) return ignore('unsupported_topic');

  const webhookId = input.headers.get('x-shopify-webhook-id');
  if (webhookId === null || !/^[A-Za-z0-9-]{8,100}$/.test(webhookId)) {
    return reject('missing_webhook_id', 400);
  }
  if (await input.replay.seen(webhookId)) return ignore('replayed');

  // The header is unsigned and an absent one is not an attack signal (Shopify documents it, but a missing header must
  // not make us drop real orders): without it the window is skipped and the HMAC, the webhook id store and the
  // per-order coalescer carry the replay control. A PRESENT header is still checked.
  const triggeredHeader = input.headers.get('x-shopify-triggered-at');
  if (input.maxAgeMs !== undefined && triggeredHeader !== null) {
    const triggeredAt = Date.parse(triggeredHeader);
    if (!Number.isFinite(triggeredAt)) return reject('invalid_timestamp', 400);
    const age = input.now() - triggeredAt;
    if (age < -(input.maxFutureSkewMs ?? DEFAULT_FUTURE_SKEW_MS)) {
      return reject('invalid_timestamp', 400);
    }
    if (age > input.maxAgeMs) return ignore('stale');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch {
    return reject('malformed_payload', 400);
  }
  const routed = routeShopifyTopic(topic, payload);
  if (routed.status === 'error') {
    return routed.reason === 'unsupported_topic'
      ? ignore('unsupported_topic')
      : reject('malformed_payload', 400);
  }
  return {status: 'accepted', webhookId, action: routed.action};
}
