// Guest order tracking by order number and email (REQ-ACC-003, P6-08, SD-05, Q-009, threat T-09).
// UNVERIFIED against a real store: it needs the read_orders-only Admin token and a development store (V-09, V-20).
//
//   GET  /track-order  the form (or the unavailable notice). The query string is never read: a link cannot start a
//                      lookup or pre-fill the form.
//   POST /track-order  the lookup, handled in app/lib/orders/guest-lookup-handler.ts: same-origin only, rate limited,
//                      one generic answer for every failure, a minimal order view only on a match, no PII in logs.
// Design, limits and the list of unverified assumptions: docs/integrations/GUEST_TRACKING.md.
import {useEffect, useId, useRef} from 'react';
import {
  data,
  useActionData,
  useLoaderData,
  useNavigation,
  type HeadersFunction,
} from 'react-router';
import type {Route} from './+types/track-order';
import {GuestLookupNotice} from '~/components/orders/GuestLookupNotice';
import {GuestOrderLookupForm} from '~/components/orders/GuestOrderLookupForm';
import {GuestOrderSummary} from '~/components/orders/GuestOrderSummary';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {noStoreHeaders} from '~/lib/cart/http';
import {
  GUEST_LOOKUP_UNAVAILABLE_MESSAGE,
  guestLookupConfigured,
  guestLookupDepsFromEnv,
  handleGuestLookup,
  type GuestLookupResponse,
} from '~/lib/orders/guest-lookup-handler';

export const meta: Route.MetaFunction = () => [
  {title: formatPageTitle('Track your order')},
  {name: 'robots', content: 'noindex, nofollow'},
];

// Per-shopper answer: no shared cache may keep it. The action's headers (Retry-After, X-Robots-Tag) are kept.
export const headers: HeadersFunction = ({actionHeaders, loaderHeaders}) => {
  const merged = noStoreHeaders(loaderHeaders);
  actionHeaders.forEach((value, name) => merged.set(name, value));
  merged.set('X-Robots-Tag', 'noindex, nofollow');
  return merged;
};

export function loader({context}: Route.LoaderArgs) {
  // Reads configuration names only: nothing from the request, so no lookup is possible from a GET.
  return data(
    {available: guestLookupConfigured(context.env)},
    {headers: noStoreHeaders()},
  );
}

export async function action({request, context}: Route.ActionArgs) {
  const result = await handleGuestLookup(
    request,
    guestLookupDepsFromEnv(context.env),
  );
  return data<GuestLookupResponse>(result.response, {
    status: result.status,
    headers: result.headers,
  });
}

const NOTICE_TITLE = {
  not_found: 'We could not find an order',
  rate_limited: 'Please wait before trying again',
  unavailable: 'Order lookup is not available right now',
} as const;

export default function TrackOrderPage() {
  const {available} = useLoaderData<typeof loader>();
  const posted = useActionData<typeof action>();
  const navigation = useNavigation();
  const resultRef = useRef<HTMLDivElement>(null);
  const noticeId = useId();

  // Move focus to the answer so a keyboard or screen reader user lands on it, not on the form above.
  useEffect(() => {
    if (posted !== undefined) resultRef.current?.focus();
  }, [posted]);

  const unavailable = !available || posted?.status === 'unavailable';

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-8">
      <h1 className="text-3xl font-bold">Track your order</h1>
      <p className="text-fg-muted">
        Enter your order number and the email address you used. This works for
        orders placed in the last 60 days. For older orders, sign in to your
        account or use the link in your confirmation email.
      </p>

      {unavailable ? (
        <GuestLookupNotice
          title={NOTICE_TITLE.unavailable}
          message={GUEST_LOOKUP_UNAVAILABLE_MESSAGE}
          headingId={noticeId}
        />
      ) : (
        <>
          <GuestOrderLookupForm busy={navigation.state === 'submitting'} />
          <div
            ref={resultRef}
            tabIndex={-1}
            aria-live="polite"
            className="flex flex-col gap-4 outline-none"
          >
            {posted?.status === 'found' ? (
              <GuestOrderSummary order={posted.order} />
            ) : null}
            {posted !== undefined && posted.status !== 'found' ? (
              <GuestLookupNotice
                title={NOTICE_TITLE[posted.status]}
                message={posted.message}
                headingId={noticeId}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
