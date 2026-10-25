import type {Route} from './+types/account_.quiz-sync';
import {
  accountErrorStatus,
  accountFailure,
  accountNoStoreHeaders,
  type AccountErrorCode,
} from '~/lib/account/results';
import {isSameOriginRequest} from '~/lib/cart/http';
import {readSmallForm} from '~/lib/delivery-runtime/form';
import {SYNC_REQUEST_MAX_BYTES} from '~/lib/quiz/account-sync';
import {
  deleteAccountQuiz,
  prepareAccountSave,
  readAccountQuiz,
  writeAccountQuiz,
} from '~/lib/quiz/account-sync.server';

// P6-04 / REQ-QZ-005: the quiz page's sync endpoint for a signed-in shopper. A resource route outside the account
// layout (`account_.`): it answers JSON and never redirects, so the quiz page can ask "am I signed in, and is there
// a saved result?" with a plain fetch. GET reads, POST saves, DELETE clears. The customer is the session's;
// nothing in the request names one. Responses are never cacheable (T-05, T-11).

function json(body: unknown, status = 200): Response {
  return Response.json(body, {status, headers: accountNoStoreHeaders()});
}

function fail(code: AccountErrorCode): Response {
  return json(accountFailure(code), accountErrorStatus(code));
}

export async function loader({context}: Route.LoaderArgs) {
  const {customerAccount} = context;
  if (!(await customerAccount.isLoggedIn())) {
    return json({status: 'signed_out'});
  }
  const read = await readAccountQuiz(customerAccount);
  if (read.status === 'signed_out') return json({status: 'signed_out'});
  if (read.status === 'unavailable') return json({status: 'unavailable'});
  return json({status: 'ok', saved: read.summary});
}

export async function action({request, context}: Route.ActionArgs) {
  const {customerAccount} = context;

  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return fail('method-not-allowed');
  }
  if (!isSameOriginRequest(request)) return fail('forbidden');
  if (!(await customerAccount.isLoggedIn())) return fail('signed-out');

  let payload: unknown = null;
  if (request.method === 'POST') {
    const form = await readSmallForm(request, SYNC_REQUEST_MAX_BYTES + 512);
    if (form.status !== 'ok') return fail('invalid-request');
    payload = form.form.get('payload');
  }

  const prepared =
    request.method === 'POST'
      ? await prepareAccountSave(payload, Date.now(), context.storefront)
      : null;
  if (prepared?.status === 'invalid') return fail('invalid-request');

  const read = await readAccountQuiz(customerAccount);
  if (read.status === 'signed_out') return fail('signed-out');
  if (read.status === 'unavailable') return json({status: 'unavailable'});

  const written =
    prepared?.status === 'ok'
      ? await writeAccountQuiz(customerAccount, read.customerId, prepared.json)
      : await deleteAccountQuiz(customerAccount, read.customerId);
  if (written.status === 'signed_out') return fail('signed-out');
  if (written.status === 'unavailable') return json({status: 'unavailable'});

  return json({status: prepared?.status === 'ok' ? 'saved' : 'cleared'});
}
