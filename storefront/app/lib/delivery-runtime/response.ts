// The one JSON shape the /delivery route answers with, for the loader, the action and the components
// that read it. Plain data only: a status, the ZIP the shopper themselves saved, and a fixed error code.

import type {DeliveryView} from '~/lib/delivery/status';

export type DeliveryError = 'invalid-zip' | 'save-failed';

export type DeliveryResponse = {
  readonly delivery: DeliveryView;
  readonly error: DeliveryError | null;
};

/** Shopper-facing text per error code; the code is fixed, nothing from the request is echoed back. */
export const DELIVERY_ERROR_TEXT: Record<DeliveryError, string> = {
  'invalid-zip': 'Enter a 5-digit US ZIP code.',
  'save-failed':
    'We could not save your ZIP code. You can still continue shopping.',
};

/**
 * The delivery answer carried in the root loader's data, read back as a typed value. Route data reaches
 * components untyped (`useRouteLoaderData` without the root type, to avoid an import cycle), so it is checked
 * here rather than cast. Anything that does not match means "no seed": the caller then asks `/delivery`.
 */
export function readDeliverySeed(rootData: unknown): DeliveryResponse | null {
  if (typeof rootData !== 'object' || rootData === null) return null;
  const seed: unknown = Reflect.get(rootData, 'deliverySeed');
  if (typeof seed !== 'object' || seed === null) return null;
  const view: unknown = Reflect.get(seed, 'delivery');
  if (typeof view !== 'object' || view === null) return null;
  const status: unknown = Reflect.get(view, 'status');
  switch (status) {
    case 'unavailable':
    case 'no-zip':
      return {delivery: {status}, error: null};
    case 'outside-zone': {
      const zip: unknown = Reflect.get(view, 'zip');
      return typeof zip === 'string'
        ? {delivery: {status, zip}, error: null}
        : null;
    }
    case 'in-zone': {
      const zip: unknown = Reflect.get(view, 'zip');
      const promise: unknown = Reflect.get(view, 'promise');
      if (typeof zip !== 'string') return null;
      return {
        delivery: {
          status,
          zip,
          promise: typeof promise === 'string' ? promise : null,
        },
        error: null,
      };
    }
    default:
      return null;
  }
}
