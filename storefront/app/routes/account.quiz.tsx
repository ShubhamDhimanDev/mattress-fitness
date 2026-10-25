import {Form, Link, data, useLoaderData} from 'react-router';
import type {Route} from './+types/account.quiz';
import {
  accountErrorStatus,
  accountFailure,
  accountNoStoreHeaders,
  requireAccountSession,
} from '~/lib/account/results';
import {isSameOriginRequest} from '~/lib/cart/http';
import {getQuizConfigRaw, getQuizProducts} from '~/lib/pages/data-source';
import {answerRows} from '~/lib/quiz/account-sync';
import {
  deleteAccountQuiz,
  readAccountQuiz,
} from '~/lib/quiz/account-sync.server';
import {resolveQuizConfig} from '~/lib/quiz/default-config';

// P6-04 / REQ-QZ-005: "Your sleep quiz result" in the account. Read-only apart from clearing it. Handles are shown
// only when they are still in the recommendation source, so a stale or tampered handle never becomes a link.

export const meta: Route.MetaFunction = () => [
  {title: 'Your sleep quiz result'},
];

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

export async function loader({context}: Route.LoaderArgs) {
  const {customerAccount} = context;
  await requireAccountSession(customerAccount);

  const [read, rawConfig, catalog] = await Promise.all([
    readAccountQuiz(customerAccount),
    getQuizConfigRaw(context.storefront),
    getQuizProducts(),
  ]);
  if (read.status !== 'ok') {
    return data(
      {
        status: read.status === 'signed_out' ? 'signed_out' : 'unavailable',
      } as const,
      {headers: accountNoStoreHeaders()},
    );
  }
  if (!read.summary) {
    return data({status: 'none'} as const, {headers: accountNoStoreHeaders()});
  }
  const config = resolveQuizConfig(rawConfig).config;
  const titles = new Map(
    catalog.products.map((product) => [product.handle, product.title]),
  );
  return data(
    {
      status: 'ok',
      savedOn: DATE_FORMAT.format(new Date(read.summary.savedAt)),
      rows: answerRows(read.summary.answers, config),
      picks: read.summary.handles.flatMap((handle) => {
        const title = titles.get(handle);
        return title ? [{handle, title}] : [];
      }),
    } as const,
    {headers: accountNoStoreHeaders()},
  );
}

export async function action({request, context}: Route.ActionArgs) {
  const {customerAccount} = context;
  const fail = (code: 'method-not-allowed' | 'forbidden' | 'signed-out') =>
    data(accountFailure(code), {
      status: accountErrorStatus(code),
      headers: accountNoStoreHeaders(),
    });

  if (request.method !== 'DELETE') return fail('method-not-allowed');
  if (!isSameOriginRequest(request)) return fail('forbidden');
  if (!(await customerAccount.isLoggedIn())) return fail('signed-out');

  const read = await readAccountQuiz(customerAccount);
  if (read.status === 'signed_out') return fail('signed-out');
  if (read.status === 'ok') {
    await deleteAccountQuiz(customerAccount, read.customerId);
  }
  // Fail soft: the loader shows what is still stored.
  return data({status: 'done'} as const, {headers: accountNoStoreHeaders()});
}

export default function AccountQuiz() {
  const result = useLoaderData<typeof loader>();

  return (
    <div className="account-quiz">
      <h2>Your sleep quiz result</h2>
      <br />
      {result.status === 'ok' ? (
        <>
          <p>Saved on {result.savedOn}.</p>
          <br />
          <dl>
            {result.rows.map((row) => (
              <div key={row.question}>
                <dt>{row.question}</dt>
                <dd>{row.answer}</dd>
              </div>
            ))}
          </dl>
          <br />
          {result.picks.length > 0 ? (
            <>
              <h3>Your top matches then</h3>
              <ul>
                {result.picks.map((pick) => (
                  <li key={pick.handle}>
                    <Link to={`/products/${pick.handle}`}>{pick.title}</Link>
                  </li>
                ))}
              </ul>
              <br />
            </>
          ) : null}
          <p>
            <Link to="/quiz">Retake the quiz</Link>
          </p>
          <br />
          <Form method="DELETE">
            <button type="submit">Clear my saved result</button>
          </Form>
        </>
      ) : null}
      {result.status === 'none' ? (
        <p>
          You have no saved quiz result yet.{' '}
          <Link to="/quiz">Take the quiz</Link> while signed in and your result
          is kept here.
        </p>
      ) : null}
      {result.status === 'unavailable' || result.status === 'signed_out' ? (
        <p role="status">
          We could not load your saved quiz result just now. Your result is
          still kept on this device. <Link to="/quiz">Open the quiz</Link>
        </p>
      ) : null}
    </div>
  );
}
