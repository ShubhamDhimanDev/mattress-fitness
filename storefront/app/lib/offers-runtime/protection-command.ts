// What a /checkout-steps form post for the accident-protection step may ask for (P5A-07). The browser names the step, an
// intent and, for an accept, a cart line and a plan key. Everything else (which variant, which price, how many units)
// is decided on the server against the real cart (protection-steps.ts). Unknown combinations are refused whole, never
// guessed at. Pure. Kept apart from delivery-runtime/step-command.ts, which parses the other three steps.

import {LINE_ID} from '~/lib/cart/actions';
import {isPlausiblePlanId} from '~/lib/extend/ids';
import {PROTECTION_STEP} from './view';

export type ProtectionCommand =
  | {
      readonly step: typeof PROTECTION_STEP;
      readonly intent: 'accept';
      readonly lineId: string;
      readonly planKey: string;
    }
  | {readonly step: typeof PROTECTION_STEP; readonly intent: 'decline'};

type FormLike = {get(name: string): unknown};

function text(form: FormLike, name: string): string | null {
  const value = form.get(name);
  return typeof value === 'string' ? value : null;
}

/** Null for anything that is not the protection step with one of its own intents. */
export function parseProtectionCommand(
  form: FormLike,
): ProtectionCommand | null {
  if (text(form, 'step') !== PROTECTION_STEP) return null;
  const intent = text(form, 'intent');
  if (intent === 'decline') return {step: PROTECTION_STEP, intent};
  if (intent !== 'accept') return null;
  const lineId = text(form, 'lineId');
  const planKey = text(form, 'planKey');
  if (lineId === null || !LINE_ID.test(lineId) || !isPlausiblePlanId(planKey)) {
    return null;
  }
  return {step: PROTECTION_STEP, intent, lineId, planKey};
}
