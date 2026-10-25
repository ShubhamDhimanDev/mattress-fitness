// Server-side proxy for product reviews (P3B-12, REQ-PDP-005, NFR-013, T-13). Resource route.
//   GET /api/reviews?handle=queen-mattress&page=1&limit=5    (shape: lib/reviews/api.ts)
// The browser sends a product handle and a page number only. The provider's private token, the vendor's host and its raw
// answers never leave the server; review text is sanitised and authors are reduced to a first name and an initial before
// they get here. `{"status":"unavailable"}` (HTTP 200) means "show no reviews yet": provider off, slow, down or malformed.
// With REVIEWS_PROVIDER unset this route answers 404 and the product page never calls it.
import type {Route} from './+types/api.reviews';
import {isSameOriginRequest} from '~/lib/cart/http';
import {parseReviewsQuery, type ReviewsApiResponse} from '~/lib/reviews/api';
import {getReviewsRuntime} from '~/lib/reviews/runtime';

// Public data (no personal data in it, no cookies read), so a short shared cache is fine; failures are never cached.
const OK_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=300';

function json(body: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function loader({request, context}: Route.LoaderArgs) {
  // A GET from another site (Sec-Fetch-Site: cross-site, or an Origin of another host) is refused. No header at all (curl,
  // old clients) passes: this is a courtesy guard, the memory and the call ceiling in lib/reviews/service.ts are the cost
  // controls.
  if (!isSameOriginRequest(request)) {
    return json({status: 'invalid'}, 403, 'no-store');
  }
  const runtime = await getReviewsRuntime(context.env, import.meta.env.DEV);
  if (runtime.status === 'off') return json({status: 'off'}, 404, 'no-store');
  const query = parseReviewsQuery(new URL(request.url));
  if (query === null) return json({status: 'invalid'}, 400, 'no-store');

  const [page, summary] = await Promise.all([
    runtime.service.page(query.handle, {page: query.page, limit: query.limit}),
    // The aggregate rides along with the first page only.
    query.page === 1
      ? runtime.service.summary(query.handle)
      : Promise.resolve(null),
  ]);
  if (page.status === 'unavailable') {
    const body: ReviewsApiResponse = {status: 'unavailable'};
    return json(body, 200, 'no-store');
  }
  const body: ReviewsApiResponse = {
    status: 'ok',
    page: query.page,
    aggregate: summary?.status === 'ok' ? summary.aggregate : null,
    reviews: page.reviews,
    hasMore: page.hasMore,
  };
  return json(body, 200, OK_CACHE);
}
