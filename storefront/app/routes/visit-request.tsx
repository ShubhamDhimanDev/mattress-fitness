// "Plan your visit" form submissions, POST only (CR-33, DEC-144, T-05, T-13). The flow is in app/lib/leads/visit-handler.ts:
// same origin, rate limited, a honeypot, then one save of a tagged Shopify customer. GET answers 405 and reads nothing
// from the URL; the page is noindex.
import {data, type HeadersFunction} from 'react-router';
import type {Route} from './+types/visit-request';
import {noStoreHeaders} from '~/lib/cart/http';
import {handleVisitRequest, visitDepsFromEnv} from '~/lib/leads/visit-handler';
import type {VisitRequestResponse} from '~/lib/leads/visit-request';

export const headers: HeadersFunction = ({actionHeaders, loaderHeaders}) => {
  const merged = noStoreHeaders(loaderHeaders);
  actionHeaders.forEach((value, name) => merged.set(name, value));
  merged.set('X-Robots-Tag', 'noindex, nofollow');
  return merged;
};

export function loader() {
  return data(null, {
    status: 405,
    headers: noStoreHeaders({Allow: 'POST'}),
  });
}

export async function action({request, context}: Route.ActionArgs) {
  const result = await handleVisitRequest(
    request,
    visitDepsFromEnv(context.env),
  );
  return data<VisitRequestResponse>(result.response, {
    status: result.status,
    headers: result.headers,
  });
}

// With JavaScript the form posts here through a fetcher and the answer appears in place; without it the browser lands
// here and this shows the answer.
export default function VisitRequestPage({actionData}: Route.ComponentProps) {
  return (
    <p role="status" className="py-16 text-lead">
      {actionData?.message ?? ''}
    </p>
  );
}
