// SERVER ONLY. Runs the signup's destinations together: the main one (Klaviyo, or the SMTP email to the team) and the Shopify
// customer with the `subscribe` tag. Both get every signup. The shopper sees "thank you" when at least one took it, and
// the one that failed is logged by reason code so the team can fix it; only when both fail does the shopper see "try again
// later". Null when nothing is configured: nothing is faked.

import {logWarn} from '~/lib/logging/logger';
import type {
  KlaviyoClient,
  SubscribeRequest,
  SubscribeResult,
} from '~/lib/signup/klaviyo-client';

async function attempt(
  client: KlaviyoClient,
  request: SubscribeRequest,
): Promise<SubscribeResult> {
  try {
    return await client.subscribe(request);
  } catch {
    return {status: 'failed', reason: 'network'};
  }
}

export function combineSubscribers(
  main: KlaviyoClient | null,
  shopify: KlaviyoClient | null,
): KlaviyoClient | null {
  if (main === null) return shopify;
  if (shopify === null) return main;
  return {
    async subscribe(request) {
      const [first, second] = await Promise.all([
        attempt(main, request),
        attempt(shopify, request),
      ]);
      if (first.status === 'failed') {
        logWarn('signup.destination_failed', {
          destination: 'main',
          reason: first.reason,
        });
      }
      if (second.status === 'failed') {
        logWarn('signup.destination_failed', {
          destination: 'shopify_customer',
          reason: second.reason,
        });
      }
      return first.status === 'accepted' || second.status === 'accepted'
        ? {status: 'accepted'}
        : first;
    },
  };
}
