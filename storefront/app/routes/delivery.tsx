import {
  data,
  Link,
  useActionData,
  useLoaderData,
  type HeadersFunction,
} from 'react-router';
import type {Route} from './+types/delivery';
import {DeliveryCheck} from '~/components/delivery/DeliveryCheck';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {isSameOriginRequest, noStoreHeaders} from '~/lib/cart/http';
import {parseZip} from '~/lib/delivery/zip';
import {readSmallForm} from '~/lib/delivery-runtime/form';
import type {
  DeliveryError,
  DeliveryResponse,
} from '~/lib/delivery-runtime/response';
import {deliveryViewForEnv} from '~/lib/delivery-runtime/view';
import {
  clearDeliveryZipHeader,
  deliveryZipSavingAvailable,
  readDeliveryZip,
  saveDeliveryZipHeader,
} from '~/lib/delivery-runtime/zip-cookie';

export const meta: Route.MetaFunction = () => [
  {title: formatPageTitle('Check delivery to your ZIP code')},
  {name: 'robots', content: 'noindex'},
];

// The answer depends on a cookie holding the shopper's ZIP: no shared cache may keep it (T-05, ARCHITECTURE 7).
export const headers: HeadersFunction = ({actionHeaders, loaderHeaders}) =>
  noStoreHeaders(
    actionHeaders.has('Set-Cookie') ? actionHeaders : loaderHeaders,
  );

function respond(
  body: DeliveryResponse,
  init: {status?: number; headers?: Headers} = {},
) {
  return data(body, {
    status: init.status ?? 200,
    headers: noStoreHeaders(init.headers),
  });
}

function failure(
  env: object,
  zip: string | null,
  error: DeliveryError,
  status: number,
) {
  return respond({delivery: deliveryViewForEnv(env, zip), error}, {status});
}

/**
 * The saved ZIP and what delivery means for it, for the product page and the cart. A resource for the
 * browser to read after the (cacheable) page has loaded: the page itself never carries the ZIP.
 */
export async function loader({request, context}: Route.LoaderArgs) {
  const zip = await readDeliveryZip(request, context.env);
  return respond({
    delivery: deliveryViewForEnv(context.env, zip),
    error: null,
  });
}

/**
 * Save or clear the shopper's ZIP (P3B-11, REQ-NAV-003). The ZIP travels in the POST body only, never in a
 * URL, is validated here (5 digits, ZIP+4 reduced to 5) and is stored in a signed HttpOnly cookie. Nothing
 * about it is logged. A form posted without JavaScript is answered by this route's own page (the answer
 * renders in place, errors included); a script gets the same data as JSON.
 */
export async function action({request, context}: Route.ActionArgs) {
  const {env} = context;
  const current = await readDeliveryZip(request, env);
  if (!isSameOriginRequest(request)) {
    return failure(env, current, 'save-failed', 403);
  }
  // Production without a usable signing secret: nothing can be kept, so say so before reading the body.
  if (!deliveryZipSavingAvailable(env)) {
    return failure(env, null, 'save-failed', 503);
  }
  const read = await readSmallForm(request);
  // An oversized or unreadable body is refused with a fixed message before anything is parsed further.
  if (read.status !== 'ok') {
    return failure(
      env,
      current,
      'save-failed',
      read.status === 'too-large' ? 413 : 400,
    );
  }
  const {form} = read;
  const intent = form.get('intent');

  if (intent !== 'save' && intent !== 'clear') {
    return failure(env, current, 'save-failed', 400);
  }

  let cookie: string | null;
  let zip: string | null;
  if (intent === 'clear') {
    zip = null;
    cookie = await clearDeliveryZipHeader(request, env);
  } else {
    const parsed = parseZip(form.get('zip'));
    if (!parsed.ok) return failure(env, current, 'invalid-zip', 400);
    zip = parsed.zip;
    cookie = await saveDeliveryZipHeader(parsed.zip, request, env);
  }
  // No secret to sign with: say so rather than pretend the ZIP was kept.
  if (cookie === null) return failure(env, current, 'save-failed', 503);

  const responseHeaders = noStoreHeaders();
  responseHeaders.append('Set-Cookie', cookie);
  return respond(
    {delivery: deliveryViewForEnv(env, zip), error: null},
    {headers: responseHeaders},
  );
}

/** A plain page for browsers without JavaScript, and a place to link to. */
export default function DeliveryPage() {
  const loaded = useLoaderData<typeof loader>();
  const posted = useActionData<typeof action>();
  const response: DeliveryResponse = posted ?? loaded;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-8">
      <h1 className="type-display text-3xl md:text-4xl">
        Delivery to your ZIP code
      </h1>
      <DeliveryCheck
        initial={response}
        title="Check your ZIP code"
        showWhenUnavailable
      />
      <Link to="/collections" className="font-bold underline">
        Continue shopping
      </Link>
    </div>
  );
}
