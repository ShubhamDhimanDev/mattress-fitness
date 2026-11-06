// Turns the offer configuration the cart gate loads from Shopify (offers-runtime/shopify-rules.ts) into what the detective check needs
// (P5B-05). One source for the rules and the zone, so the cart and the order check cannot disagree about what is allowed.

import type {DetectiveConfig} from '~/lib/detective/types';
import type {OfferConfigLoad} from '~/lib/offers-runtime/config';

/**
 * `none` (no Admin token to read Shopify with) and `invalid` (Shopify could not be read and nothing good was loaded before) are NOT "no rules": they leave the check unable to recognise a
 * gift, a protector or a haul-away line, and the caller must say so for every order instead of reporting it clean.
 * `ok` with an empty rule set means Shopify was read and holds no offers.
 */
export function detectiveConfigFromOffers(
  load: OfferConfigLoad,
): DetectiveConfig {
  switch (load.status) {
    case 'ok':
      return {
        status: 'ready',
        rules: load.config.rules,
        zone: load.config.zone,
      };
    case 'none':
      return {status: 'unavailable', reason: 'no_config'};
    case 'invalid':
      return {status: 'unavailable', reason: 'invalid_config'};
    default: {
      const unreachable: never = load.status;
      return unreachable;
    }
  }
}
