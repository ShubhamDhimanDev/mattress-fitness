// What the shopper is told about delivery to their saved ZIP (REQ-DEL-001, REQ-DEL-002, REQ-NAV-003).
// Pure and serialisable: the /delivery route builds it on the server and the product page, cart and any
// other surface only render it. It never states a date or a fee: the only wording that can appear is the
// client-approved promise text from the delivery zone, and an empty text means no promise line at all.

import {parseZip} from './zip';
import {isInZone, promiseFor, type DeliveryZone} from './zone';

export type DeliveryView =
  /** No delivery zone is configured, so nothing can be said (fail closed: neither yes nor no is claimed). */
  | {readonly status: 'unavailable'}
  | {readonly status: 'no-zip'}
  | {
      readonly status: 'in-zone';
      readonly zip: string;
      /** Client-approved in-home wording, or null when the client has not supplied any. */
      readonly promise: string | null;
    }
  | {readonly status: 'outside-zone'; readonly zip: string};

/**
 * `zip` is untrusted (a cookie): anything that is not a valid ZIP reads as "no ZIP", never as a yes.
 * ZIP+4 is reduced to the 5-digit code the zone list is written in.
 */
export function deliveryViewFor(
  zone: DeliveryZone | null,
  zip: unknown,
): DeliveryView {
  if (zone === null) return {status: 'unavailable'};
  const parsed = parseZip(zip);
  if (!parsed.ok) return {status: 'no-zip'};
  if (!isInZone(zone, parsed.zip)) {
    return {status: 'outside-zone', zip: parsed.zip};
  }
  const promise = promiseFor(zone, parsed.zip, 'in-home');
  return {
    status: 'in-zone',
    zip: parsed.zip,
    promise: promise.status === 'promise' ? promise.text : null,
  };
}
