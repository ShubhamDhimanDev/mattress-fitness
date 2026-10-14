// What a /checkout-steps form post may ask for (P4-09, P5B-04). The browser names a step and an intent;
// everything else (which variant, how many pieces are allowed, whether in-home is possible) is decided on the
// server against the real cart. Unknown combinations are refused whole, never guessed at. Pure.

import {parseDeliveryChoice} from '~/lib/offers/attributes';
import type {DeliveryChoice} from '~/lib/offers/types';
import {SUPPORTED_STEPS, type SupportedStepId} from '~/lib/offers-runtime/view';

export type StepId = SupportedStepId;

export function parseStepId(value: unknown): StepId | null {
  return SUPPORTED_STEPS.find((step) => step === value) ?? null;
}

export type StepCommand =
  | {
      readonly step: 'comfort-guarantee';
      readonly intent: 'accept' | 'decline';
    }
  | {
      readonly step: 'delivery-choice';
      readonly intent: 'choose';
      readonly choice: DeliveryChoice;
    }
  | {
      readonly step: 'haul-away';
      readonly intent: 'accept';
      /** The shopper's request as a number (NaN when unreadable); the server clamps it to the engine's maximum. */
      readonly pieces: number;
    }
  | {readonly step: 'haul-away'; readonly intent: 'decline'};

type FormLike = {get(name: string): unknown};

function text(form: FormLike, name: string): string | null {
  const value = form.get(name);
  return typeof value === 'string' ? value : null;
}

// Digits only, a few of them: "2e3", "0x10", " 3 " and "3.5" are all unreadable rather than "close enough".
const PIECES = /^[0-9]{1,3}$/;

/** Null for anything that is not a known step with one of its own intents. */
export function parseStepCommand(form: FormLike): StepCommand | null {
  const step = parseStepId(text(form, 'step'));
  const intent = text(form, 'intent');
  switch (step) {
    case 'comfort-guarantee':
      return intent === 'accept' || intent === 'decline'
        ? {step, intent}
        : null;
    case 'delivery-choice': {
      if (intent !== 'choose') return null;
      const choice = parseDeliveryChoice(text(form, 'choice'));
      return choice === null ? null : {step, intent, choice};
    }
    case 'haul-away': {
      if (intent === 'decline') return {step, intent};
      if (intent !== 'accept') return null;
      const raw = text(form, 'pieces');
      return {
        step,
        intent,
        pieces: raw !== null && PIECES.test(raw) ? Number(raw) : Number.NaN,
      };
    }
    case null:
      return null;
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}
