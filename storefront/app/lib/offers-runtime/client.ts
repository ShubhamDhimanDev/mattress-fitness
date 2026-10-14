// Reading the offers view back in the browser. The view arrives in a loader or action result (data from our
// own server), but fetcher data is typed `unknown`, so it is checked before use. A view that does not look
// right is ignored and the cart simply shows no offers (NFR-013).

import {isPlausiblePlanId} from '~/lib/extend/ids';
import type {CartOffersView, ProtectionPlanView} from './view';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Documented narrowing helper: structural check of the fields the cart UI reads. */
export function isOffersView(value: unknown): value is CartOffersView {
  return (
    isRecord(value) &&
    isRecord(value.freeDelivery) &&
    typeof value.freeDelivery.enabled === 'boolean' &&
    isRecord(value.lineSizes) &&
    (value.accidentProtection === null ||
      (isRecord(value.accidentProtection) &&
        Array.isArray(value.accidentProtection.lines))) &&
    Array.isArray(value.gifts) &&
    Array.isArray(value.addOns) &&
    Array.isArray(value.blocked) &&
    Array.isArray(value.notices) &&
    (value.updatedAt === null || typeof value.updatedAt === 'string')
  );
}

/** The offers view inside a cart action or `/cart` loader result, or null. */
export function readOffersView(data: unknown): CartOffersView | null {
  return isRecord(data) && isOffersView(data.offers) ? data.offers : null;
}

/**
 * Picks the view that describes the cart on screen. A view for the same cart version is used; so is a NEWER
 * one: a page load can repair the cart (removing an orphaned gift) after the drawer's cart was read, and the
 * drawer should then show the repaired cart's offers rather than none. An older view is never used. An
 * optimistic cart has no version of its own, so the caller passes the server cart's. With several usable
 * views the newest wins; ties keep the first.
 */
export function pickOffersView(
  candidates: readonly (CartOffersView | null)[],
  cartUpdatedAt: string | null | undefined,
): CartOffersView | null {
  if (!cartUpdatedAt) return null;
  const cartTime = Date.parse(cartUpdatedAt);
  let best: CartOffersView | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const view of candidates) {
    if (view === null || view.updatedAt === null) continue;
    if (view.updatedAt === cartUpdatedAt) {
      if (bestTime < cartTime || best === null) {
        best = view;
        bestTime = cartTime;
      }
      continue;
    }
    const time = Date.parse(view.updatedAt);
    if (Number.isNaN(time) || Number.isNaN(cartTime) || time < cartTime)
      continue;
    if (time > bestTime) {
      best = view;
      bestTime = time;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------
// The offers route answer, as the product page reads it (P5A-05)
// ---------------------------------------------------------------------------------------------------

/** What the product page does with an offers answer: show these plans, or show nothing at all. */
export type ProtectionAnswer =
  | {readonly status: 'plans'; readonly plans: readonly ProtectionPlanView[]}
  | {readonly status: 'hidden'};

const HIDDEN: ProtectionAnswer = {status: 'hidden'};
const MAX_PLANS = 6;

function planOf(value: unknown): ProtectionPlanView | null {
  if (!isRecord(value)) return null;
  const {planId, title, priceCents, termMonths, termsUrl, recommended} = value;
  if (
    !isPlausiblePlanId(planId) ||
    typeof title !== 'string' ||
    title.trim() === '' ||
    title.length > 200 ||
    typeof priceCents !== 'number' ||
    !Number.isSafeInteger(priceCents) ||
    priceCents <= 0 ||
    typeof termsUrl !== 'string'
  ) {
    return null;
  }
  // The link is rendered as an href: only a plain https address is ever followed.
  let terms: URL;
  try {
    terms = new URL(termsUrl);
  } catch {
    return null;
  }
  if (terms.protocol !== 'https:') return null;
  const term =
    typeof termMonths === 'number' &&
    Number.isSafeInteger(termMonths) &&
    termMonths > 0
      ? termMonths
      : null;
  return {
    planId,
    title: title.trim(),
    priceCents,
    termMonths: term,
    termsUrl: terms.href,
    recommended: recommended === true,
  };
}

/**
 * Reads the answer of GET /api/extend/offers for one variant. Anything that is not a clean "ok" with at least one
 * valid plan for THAT variant (unavailable, invalid, an answer for another variant, malformed JSON shapes) is
 * "hidden": the offer disappears and the page keeps working (NFR-013). Fetch results are `unknown`, so every field is
 * checked here before it reaches a component.
 */
export function readProtectionAnswer(
  data: unknown,
  variantId: string,
): ProtectionAnswer {
  if (!isRecord(data) || data.status !== 'ok' || !Array.isArray(data.items)) {
    return HIDDEN;
  }
  const items: readonly unknown[] = data.items;
  const item = items.find(
    (candidate) => isRecord(candidate) && candidate.variantId === variantId,
  );
  if (!isRecord(item) || !Array.isArray(item.plans)) return HIDDEN;
  const candidates: readonly unknown[] = item.plans;
  const plans: ProtectionPlanView[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates.slice(0, MAX_PLANS)) {
    const plan = planOf(candidate);
    if (plan === null || seen.has(plan.planId)) continue;
    seen.add(plan.planId);
    plans.push(plan);
  }
  return plans.length > 0 ? {status: 'plans', plans} : HIDDEN;
}

/** "36" -> "3 years of coverage"; "18" -> "18 months of coverage"; no stated term -> null (never guessed). */
export function formatCoverageTerm(months: number | null): string | null {
  if (months === null || !Number.isSafeInteger(months) || months <= 0) {
    return null;
  }
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} ${years === 1 ? 'year' : 'years'} of coverage`;
  }
  return `${months} months of coverage`;
}
