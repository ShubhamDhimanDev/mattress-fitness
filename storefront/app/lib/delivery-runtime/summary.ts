// SERVER ONLY. What the root loader tells every page about the shopper's delivery ZIP, so the header renders
// "Delivering to 60601" on the first paint instead of fetching /delivery after hydration and flashing from
// "Enter delivery ZIP". The root document is private and varies by cookie (root.tsx `headers`), which is what
// makes it safe to carry the ZIP; the ZIP is never put in a URL, a log line or a cache key (T-05).

import type {DeliveryResponse} from '~/lib/delivery-runtime/response';
import {deliveryViewForEnv} from '~/lib/delivery-runtime/view';
import {
  deliveryZipSavingAvailable,
  readDeliveryZip,
} from '~/lib/delivery-runtime/zip-cookie';

export type DeliverySummary = {
  /** The same JSON shape `/delivery` answers with, ready to seed `useDeliveryZip`. */
  readonly deliverySeed: DeliveryResponse;
  /** False when this deployment cannot sign the ZIP cookie; the header then shows no ZIP entry. */
  readonly deliveryZipAvailable: boolean;
};

export async function loadDeliverySummary(
  request: Request,
  env: object,
): Promise<DeliverySummary> {
  const zip = await readDeliveryZip(request, env);
  return {
    deliverySeed: {
      delivery: deliveryViewForEnv(env, zip),
      error: null,
    },
    deliveryZipAvailable: deliveryZipSavingAvailable(env),
  };
}
