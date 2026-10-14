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
