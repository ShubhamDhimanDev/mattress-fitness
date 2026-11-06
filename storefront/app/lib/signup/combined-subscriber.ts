// SERVER ONLY. Runs the signup's destinations together: the main one (Klaviyo, or the SMTP email to the team), the Shopify
// customer with the `subscribe` tag, and the welcome email with the promo code. All get every signup. The shopper sees
// "thank you" when at least one took it, and each that failed is logged by reason code so the team can fix it; only when
// all fail does the shopper see "try again later". Null when nothing is configured: nothing is faked.

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

/** Names for the log line, in the order the clients are passed: the main destination, the Shopify customer, the welcome email. */
const DESTINATIONS = ['main', 'shopify_customer', 'welcome_email'] as const;

export function combineSubscribers(
  ...clients: readonly (KlaviyoClient | null)[]
): KlaviyoClient | null {
  const present = clients.flatMap((client, index) =>
    client === null
      ? []
      : [{client, name: DESTINATIONS[index] ?? `destination_${index}`}],
  );
  const only = present[0];
  if (only === undefined) return null;
  if (present.length === 1) return only.client;
  return {
    async subscribe(request) {
      const results = await Promise.all(
        present.map(async ({client, name}) => ({
          name,
          result: await attempt(client, request),
        })),
      );
      for (const {name, result} of results) {
        if (result.status === 'failed') {
          logWarn('signup.destination_failed', {
            destination: name,
            reason: result.reason,
          });
        }
      }
      const failed = results.find(({result}) => result.status === 'failed');
      return results.some(({result}) => result.status === 'accepted')
        ? {status: 'accepted'}
        : (failed?.result ?? {status: 'failed', reason: 'unexpected'});
    },
  };
}
