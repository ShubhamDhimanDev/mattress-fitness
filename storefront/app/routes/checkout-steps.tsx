import {
  Form,
  data,
  redirect,
  useLoaderData,
  type HeadersFunction,
} from 'react-router';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import type {Route} from './+types/checkout-steps';
import {
  PlanPrice,
  PlanSummary,
  PlanTermsLink,
  PoweredByExtend,
} from '~/components/extend/PlanParts';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {Button} from '~/components/ui/Button';
import {Price} from '~/components/ui/Price';
import {Select} from '~/components/ui/Select';
import {
  CHECKOUT_STEPS_PATH,
  decideCheckout,
  getCheckoutHref,
} from '~/lib/cart/checkout';
import {isSameOriginRequest, noStoreHeaders} from '~/lib/cart/http';
import {readSmallForm} from '~/lib/delivery-runtime/form';
import {
  acceptHaulAway,
  chooseDelivery,
  declineHaulAway,
} from '~/lib/delivery-runtime/steps';
import {parseStepCommand} from '~/lib/delivery-runtime/step-command';
import {
  parseProtectionCommand,
  type ProtectionCommand,
} from '~/lib/offers-runtime/protection-command';
import {
  addProtectionToLine,
  declineProtection,
} from '~/lib/offers-runtime/protection-steps';
import {offerRuntimeOf} from '~/lib/offers-runtime/runtime';
import {
  acceptComfortGuarantee,
  declineComfortGuarantee,
  parseStepFailure,
  revalidateCartOffers,
  stepFailureText,
  type OfferRuntime,
  type OffersResult,
  type StepChangeResult,
} from '~/lib/offers-runtime/server';
import {
  parsePreCheckoutStepId,
  type PreCheckoutStepId,
} from '~/lib/offers-runtime/view';

export const meta: Route.MetaFunction = () => [
  {title: formatPageTitle('Before you check out')},
  {name: 'robots', content: 'noindex'},
];

export const headers: HeadersFunction = ({loaderHeaders, actionHeaders}) =>
  noStoreHeaders(
    actionHeaders.has('Set-Cookie') ? actionHeaders : loaderHeaders,
  );

/** The step named in the URL, only if it is one this build knows (P4-09: the step lives in the URL). */
function parseStep(raw: string | null): PreCheckoutStepId | null {
  return parsePreCheckoutStepId(raw);
}

async function check(
  context: Route.LoaderArgs['context'],
  request: Request,
  current: CartApiQueryFragment,
): Promise<OffersResult | null> {
  try {
    return await revalidateCartOffers(
      await offerRuntimeOf(context, request),
      current,
    );
  } catch (error) {
    console.error(
      'Checkout revalidation failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return null;
  }
}

/**
 * The server gate between the cart and Shopify's hosted checkout (REQ-PRE-001, REQ-PRE-006, REQ-CHK-001).
 * Every visit revalidates the real cart with the offer engine, repairs what it can, then either refuses
 * (blocked), tells the shopper what it changed (repaired), asks the next pre-checkout question (step), or
 * redirects to the cart's own Shopify checkout URL. It never redirects while blocked or after an error.
 * Reload, back and deep links are safe because the answer is recomputed from the cart each time.
 * The shopper can always skip an offer (`skip=1`); only a cart that cannot be verified is held back. This
 * guards our own storefront path; carts built directly through Shopify's API are detected after the order
 * (ADR-0006).
 */
export async function loader({request, context}: Route.LoaderArgs) {
  const current = await context.cart.get();
  // Nothing to check out: back to the cart page, which explains the empty state.
  if (!current || current.lines.nodes.length === 0) {
    return redirect('/cart', {headers: noStoreHeaders()});
  }
  const checked = await check(context, request, current);
  if (!checked) {
    return data(
      {state: 'unavailable' as const},
      {status: 503, headers: noStoreHeaders()},
    );
  }
  const params = new URL(request.url).searchParams;
  const view = checked.view;
  const notices = view?.notices ?? [];
  // Revalidation can empty the cart (a permalink that held only a gift). Nothing is left to check out, and
  // Shopify must not be sent an empty cart: say what happened and point back to the cart.
  if (!checked.cart || checked.cart.lines.nodes.length === 0) {
    return data(
      {state: 'emptied' as const, notices},
      {headers: noStoreHeaders()},
    );
  }
  const skip = params.get('skip') === '1';
  // Skipping only passes a pending question; a blocked cart is still blocked.
  const decision = decideCheckout(
    checked.cart,
    view && skip ? {...view, nextStep: null} : view,
  );

  switch (decision.status) {
    case 'ready':
      // Something was changed at the gate: say so before Shopify's page, so no total changes unseen.
      return notices.length > 0
        ? data(
            {state: 'repaired' as const, notices},
            {headers: noStoreHeaders()},
          )
        : redirect(decision.href, {headers: noStoreHeaders()});
    case 'blocked':
      return data(
        {state: 'blocked' as const, reasons: decision.reasons, notices},
        {headers: noStoreHeaders()},
      );
    case 'unavailable':
      return data(
        {state: 'unavailable' as const},
        {status: 503, headers: noStoreHeaders()},
      );
    case 'step': {
      const requested = parseStep(params.get('step'));
      if (requested !== decision.step) {
        return redirect(`${CHECKOUT_STEPS_PATH}?step=${decision.step}`, {
          headers: noStoreHeaders(),
        });
      }
      const failure = parseStepFailure(params.get('error'));
      return data(
        {
          state: 'step' as const,
          step: decision.step,
          options: view?.comfortGuarantee?.options ?? [],
          delivery: view?.deliveryChoice ?? null,
          haulAway: view?.haulAway ?? null,
          protection: view?.accidentProtection ?? null,
          notices,
          error: failure ? stepFailureText(failure) : null,
          skipHref: getCheckoutHref(checked.cart, view)
            ? `${CHECKOUT_STEPS_PATH}?skip=1`
            : null,
        },
        {headers: noStoreHeaders()},
      );
    }
    default: {
      const unreachable: never = decision;
      return unreachable;
    }
  }
}

/** Runs the one thing the form asked for, against the real cart. */
function applyCommand(
  command: NonNullable<ReturnType<typeof parseStepCommand>> | ProtectionCommand,
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
): Promise<StepChangeResult> {
  switch (command.step) {
    case 'comfort-guarantee':
      return command.intent === 'accept'
        ? acceptComfortGuarantee(runtime, current)
        : declineComfortGuarantee(runtime, current);
    case 'delivery-choice':
      return chooseDelivery(runtime, current, command.choice);
    case 'haul-away':
      return command.intent === 'accept'
        ? acceptHaulAway(runtime, current, command.pieces)
        : declineHaulAway(runtime, current);
    case 'protection':
      // The plan key is looked up again in the server's own quote; the line must be one the engine offers (P5A-07).
      return command.intent === 'accept'
        ? addProtectionToLine(runtime, current, {
            lineId: command.lineId,
            planKey: command.planKey,
          })
        : declineProtection(runtime, current);
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

/**
 * Answer the current step. Nothing but the intent comes from the browser: what an accept adds is decided
 * by the engine against the real cart (the comfort protector, the haul-away service capped at its maximum),
 * the delivery answer is recorded only if the saved ZIP allows it, and a decline is recorded as the
 * documented cart attribute (REQ-PRE-005). Either way the shopper goes back to the gate, which decides what
 * comes next; a failure travels as a known code in the redirect (shown as fixed text) and always leaves a
 * way to continue.
 */
export async function action({request, context}: Route.ActionArgs) {
  if (!isSameOriginRequest(request)) {
    throw new Response('That request could not be verified.', {
      status: 403,
      headers: noStoreHeaders(),
    });
  }
  const read = await readSmallForm(request);
  if (read.status === 'too-large') {
    throw new Response('That request is too large.', {
      status: 413,
      headers: noStoreHeaders(),
    });
  }
  const command =
    read.status === 'ok'
      ? (parseProtectionCommand(read.form) ?? parseStepCommand(read.form))
      : null;
  if (command === null) {
    throw new Response('That step is not valid.', {
      status: 400,
      headers: noStoreHeaders(),
    });
  }

  const runtime = await offerRuntimeOf(context, request);
  const current = await context.cart.get();
  const outcome = await applyCommand(command, runtime, current);
  if (outcome.status === 'rejected') {
    return redirect(
      `${CHECKOUT_STEPS_PATH}?step=${command.step}&error=${outcome.code}`,
      {headers: noStoreHeaders()},
    );
  }
  const cartId = outcome.result.cart?.id;
  return redirect(CHECKOUT_STEPS_PATH, {
    headers: noStoreHeaders(
      cartId ? context.cart.setCartId(cartId) : undefined,
    ),
  });
}

export default function CheckoutSteps() {
  const state = useLoaderData<typeof loader>();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-8">
      <h1 className="text-3xl font-bold">Before you check out</h1>
      {state.state === 'step' || state.state === 'blocked' ? (
        <Notices notices={state.notices} />
      ) : null}
      {state.state === 'step' && state.step === 'comfort-guarantee' ? (
        <ComfortGuaranteeStep
          options={state.options}
          error={state.error}
          skipHref={state.skipHref}
        />
      ) : null}
      {state.state === 'step' && state.step === 'delivery-choice' ? (
        <DeliveryChoiceStep
          delivery={state.delivery}
          error={state.error}
          skipHref={state.skipHref}
        />
      ) : null}
      {state.state === 'step' && state.step === 'haul-away' ? (
        <HaulAwayStep
          haulAway={state.haulAway}
          error={state.error}
          skipHref={state.skipHref}
        />
      ) : null}
      {state.state === 'step' && state.step === 'protection' ? (
        <ProtectionStep
          protection={state.protection}
          error={state.error}
          skipHref={state.skipHref}
        />
      ) : null}
      {state.state === 'emptied' ? (
        <section
          aria-labelledby="emptied-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="emptied-heading" className="text-xl font-bold">
            Your cart is now empty
          </h2>
          <Notices notices={state.notices} />
          <Button to="/cart" variant="primary" className="self-start">
            Back to your cart
          </Button>
        </section>
      ) : null}
      {state.state === 'repaired' ? (
        <section
          aria-labelledby="repaired-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="repaired-heading" className="text-xl font-bold">
            We updated your cart
          </h2>
          <Notices notices={state.notices} />
          <div className="flex flex-wrap gap-3">
            <Button to={CHECKOUT_STEPS_PATH} reloadDocument variant="primary">
              Continue to checkout
            </Button>
            <Button to="/cart" variant="secondary">
              Review your cart
            </Button>
          </div>
        </section>
      ) : null}
      {state.state === 'blocked' ? (
        <section
          role="alert"
          aria-labelledby="blocked-heading"
          className="flex flex-col gap-3 rounded-panel bg-error-bg p-4 text-error-fg"
        >
          <h2 id="blocked-heading" className="text-lg font-bold">
            We can&rsquo;t continue to checkout yet
          </h2>
          <ul className="list-disc pl-5">
            {state.reasons.map((reason) => (
              <li key={`${reason.code}:${reason.lineIds.join(',')}`}>
                {reason.message}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            {/* An unverified cart is usually a passing problem: say so and let the shopper try again at once. */}
            {state.reasons.some((reason) => reason.code === 'unverified') ? (
              <Button to={CHECKOUT_STEPS_PATH} reloadDocument variant="primary">
                Try again
              </Button>
            ) : null}
            <Button to="/cart" variant="secondary">
              Back to your cart
            </Button>
          </div>
        </section>
      ) : null}
      {state.state === 'unavailable' ? (
        <section role="alert" className="flex flex-col gap-3">
          <p>
            Checkout is not available right now. Please try again in a moment.
          </p>
          <Button to="/cart" variant="secondary" className="self-start">
            Back to your cart
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function Notices({notices}: {notices: readonly string[]}) {
  if (notices.length === 0) return null;
  return (
    <div role="status" className="flex flex-col gap-2">
      {notices.map((notice) => (
        <p
          key={notice}
          className="rounded-choice bg-warning-bg p-3 text-sm text-warning-fg"
        >
          {notice}
        </p>
      ))}
    </div>
  );
}

type StepData = Extract<
  ReturnType<typeof useLoaderData<typeof loader>>,
  {state: 'step'}
>;

/** Step 1 (REQ-PRE-002). Wording is placeholder copy until the client approves the comfort-guarantee rules (CLR-010). */
function ComfortGuaranteeStep({
  options,
  error,
  skipHref,
}: Pick<StepData, 'options' | 'error' | 'skipHref'>) {
  return (
    <section aria-labelledby="comfort-heading" className="flex flex-col gap-4">
      <h2 id="comfort-heading" className="text-xl font-bold">
        Protect your comfort guarantee
      </h2>
      {error ? (
        <p
          role="alert"
          className="rounded-choice bg-error-bg p-3 text-sm font-bold text-error-fg"
        >
          {error}
        </p>
      ) : null}
      <p className="text-base text-fg-muted">
        A mattress protector in your mattress size keeps your comfort guarantee
        valid.
      </p>
      <ul className="flex flex-col gap-3">
        {options.map((option) => (
          <li
            key={option.variant.variantId}
            className="flex items-baseline justify-between gap-3 rounded-card border border-line p-3"
          >
            <span>
              <span className="block font-bold">
                {option.variant.productTitle}
              </span>
              <span className="block text-sm text-fg-muted">
                Size: {option.size}
                {option.quantityMissing > 1
                  ? `, quantity ${option.quantityMissing}`
                  : ''}
              </span>
            </span>
            <Price price={option.variant.price} size="sm" />
          </li>
        ))}
      </ul>
      <Form method="post" className="flex flex-wrap gap-3">
        <input type="hidden" name="step" value="comfort-guarantee" />
        <Button type="submit" name="intent" value="accept" variant="primary">
          Add to my order
        </Button>
        <Button type="submit" name="intent" value="decline" variant="secondary">
          No thanks
        </Button>
      </Form>
      {error && skipHref ? (
        <Button
          to={skipHref}
          reloadDocument
          variant="ghost"
          className="self-start"
        >
          Continue to checkout without it
        </Button>
      ) : null}
    </section>
  );
}

function StepError({error}: {error: string | null}) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-choice bg-error-bg p-3 text-sm font-bold text-error-fg"
    >
      {error}
    </p>
  );
}

function SkipLink({href}: {href: string | null}) {
  if (!href) return null;
  return (
    <Button to={href} reloadDocument variant="ghost" className="self-start">
      Continue to checkout without it
    </Button>
  );
}

/**
 * Step 2 (P5B-04, REQ-PRE-003): in-home delivery or store pickup. Shown only for a saved ZIP inside the delivery
 * zone, so the question never promises something the ZIP cannot have. The answer is stored as the documented
 * `delivery_choice` cart attribute. Wording is placeholder copy until the client approves it (Q-008, CLR-010);
 * the only client-approved text shown is the promise per method from the delivery zone.
 */
function DeliveryChoiceStep({
  delivery,
  error,
  skipHref,
}: Pick<StepData, 'delivery' | 'error' | 'skipHref'>) {
  return (
    <section aria-labelledby="delivery-heading" className="flex flex-col gap-4">
      <h2 id="delivery-heading" className="text-xl font-bold">
        How would you like to receive your order?
      </h2>
      <StepError error={error} />
      <ul className="flex flex-col gap-3">
        <li className="rounded-card border border-line p-3">
          <span className="block font-bold">In-home delivery</span>
          {delivery?.promises.inHome ? (
            <span className="block text-sm text-fg-muted">
              {delivery.promises.inHome}
            </span>
          ) : null}
        </li>
        <li className="rounded-card border border-line p-3">
          <span className="block font-bold">Store pickup</span>
          {delivery?.promises.pickup ? (
            <span className="block text-sm text-fg-muted">
              {delivery.promises.pickup}
            </span>
          ) : null}
        </li>
      </ul>
      <Form method="post" className="flex flex-wrap gap-3">
        <input type="hidden" name="step" value="delivery-choice" />
        <input type="hidden" name="intent" value="choose" />
        <Button type="submit" name="choice" value="in-home" variant="primary">
          In-home delivery
        </Button>
        <Button type="submit" name="choice" value="pickup" variant="secondary">
          Store pickup
        </Button>
      </Form>
      {/* Answering is optional: nothing is bought here, so skipping is always offered. */}
      <SkipLink href={skipHref} />
    </section>
  );
}

/** Pieces the shopper may ask us to take away: 1 up to the admin maximum, the same cap the server applies. */
function pieceOptions(maxPieces: number) {
  return Array.from({length: maxPieces}, (_, index) => ({
    value: String(index + 1),
    label: String(index + 1),
  }));
}

/**
 * Step 3 (P5B-04, REQ-PRE-003): the recycling and disposal service, only for in-home delivery inside the
 * zone. The price shown is Shopify's for the variant; the quantity is capped at the maximum here and again on
 * the server. Wording is placeholder copy until the client approves it (CLR-010).
 */
function HaulAwayStep({
  haulAway,
  error,
  skipHref,
}: Pick<StepData, 'haulAway' | 'error' | 'skipHref'>) {
  if (!haulAway) return null;
  return (
    <section aria-labelledby="haul-heading" className="flex flex-col gap-4">
      <h2 id="haul-heading" className="text-xl font-bold">
        Remove your old mattress
      </h2>
      <StepError error={error} />
      <p className="text-base text-fg-muted">
        We can take away and recycle the pieces you are replacing when we
        deliver. You can take away up to {haulAway.maxPieces}{' '}
        {haulAway.maxPieces === 1 ? 'piece' : 'pieces'}.
      </p>
      <div className="flex items-baseline justify-between gap-3 rounded-card border border-line p-3">
        <span className="font-bold">{haulAway.variant.productTitle}</span>
        <span className="flex items-baseline gap-1 text-sm">
          <Price price={haulAway.variant.price} size="sm" />
          <span className="text-fg-muted">per piece</span>
        </span>
      </div>
      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="step" value="haul-away" />
        <Select
          label="Pieces to take away"
          name="pieces"
          options={pieceOptions(haulAway.maxPieces)}
          defaultValue="1"
        />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" name="intent" value="accept" variant="primary">
            Add to my order
          </Button>
          <Button
            type="submit"
            name="intent"
            value="decline"
            variant="secondary"
          >
            No thanks
          </Button>
        </div>
      </Form>
      {error ? <SkipLink href={skipHref} /> : null}
    </section>
  );
}

/**
 * Step 4 (P5A-07, REQ-PRE-004, REQ-EXT-004): Extend accident protection for each eligible item that is not covered yet.
 * Each plan is its own small form that posts the line id and the plan key and nothing else; the server re-reads the
 * plan, price and quantity (protection-steps.ts). "No thanks" records the documented decline attribute. Every plan shows
 * its price, term and a terms link, and the step carries Extend's branding. Wording is placeholder copy until the
 * client approves it (Q-005, CLR-010).
 */
function ProtectionStep({
  protection,
  error,
  skipHref,
}: Pick<StepData, 'protection' | 'error' | 'skipHref'>) {
  if (!protection) return null;
  return (
    <section
      aria-labelledby="protection-heading"
      className="flex flex-col gap-4"
    >
      <h2 id="protection-heading" className="text-xl font-bold">
        Protect your purchase
      </h2>
      <StepError error={error} />
      <p className="text-base text-fg-muted">
        Choose a protection plan for each item, or continue without one. The
        plan details and terms are linked under each plan.
      </p>
      {protection.lines.map((line) => (
        <div
          key={line.lineId}
          role="group"
          aria-labelledby={`protection-line-${line.lineId}`}
          className="flex flex-col gap-3 rounded-card border border-line p-3"
        >
          <h3 id={`protection-line-${line.lineId}`} className="font-bold">
            {line.productTitle}
            {line.variantTitle ? `, ${line.variantTitle}` : ''}
            {line.uncoveredQuantity > 1
              ? ` (${line.uncoveredQuantity} items)`
              : ''}
          </h3>
          <ul className="flex flex-col gap-3">
            {line.plans.map((plan) => (
              <li
                key={plan.planId}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <span className="flex min-w-0 flex-col">
                  <PlanSummary plan={plan} />
                  <PlanTermsLink plan={plan} />
                </span>
                <Form method="post" className="flex items-center gap-3">
                  <input type="hidden" name="step" value="protection" />
                  <input type="hidden" name="intent" value="accept" />
                  <input type="hidden" name="lineId" value={line.lineId} />
                  <input type="hidden" name="planKey" value={plan.planId} />
                  <PlanPrice plan={plan} />
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    aria-label={`Add ${plan.title} for ${line.productTitle}`}
                  >
                    Add protection
                  </Button>
                </Form>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Form method="post" className="flex flex-wrap gap-3">
        <input type="hidden" name="step" value="protection" />
        <Button type="submit" name="intent" value="decline" variant="secondary">
          No thanks
        </Button>
      </Form>
      <PoweredByExtend />
      {error ? <SkipLink href={skipHref} /> : null}
    </section>
  );
}
