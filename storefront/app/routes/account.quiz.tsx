import {Form, Link, data, useLoaderData} from 'react-router';
import type {Route} from './+types/account.quiz';
import {
  accountErrorStatus,
  accountFailure,
  accountNoStoreHeaders,
  requireAccountSession,
} from '~/lib/account/results';
import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
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
    <div className="account-quiz flex flex-col gap-6">
      <h2 className="type-display text-2xl md:text-3xl">
        Your sleep quiz result
      </h2>
      {result.status === 'ok' ? (
        <>
          <Card className="flex flex-col gap-4">
            <p className="text-fg-muted">Saved on {result.savedOn}.</p>
            <dl className="grid gap-4 md:grid-cols-2">
              {result.rows.map((row) => (
                <div key={row.question} className="rounded-choice bg-paper p-4">
                  <dt className="text-sm text-fg-muted">{row.question}</dt>
                  <dd className="font-extrabold">{row.answer}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {result.picks.length > 0 ? (
            <Card as="section" aria-labelledby="quiz-picks-heading">
              <h3
                id="quiz-picks-heading"
                className="type-display mb-3 text-title"
              >
                Your top matches then
              </h3>
              <ul className="flex flex-col gap-1">
                {result.picks.map((pick) => (
                  <li key={pick.handle}>
                    <Link
                      to={`/products/${pick.handle}`}
                      className="inline-flex min-h-touch items-center font-bold text-primary-700 underline underline-offset-2"
                    >
                      {pick.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button to="/quiz" size="lg">
              Retake the quiz
            </Button>
            <Form method="DELETE">
              <Button type="submit" variant="outline" size="lg">
                Clear my saved result
              </Button>
            </Form>
          </div>
        </>
      ) : null}
      {result.status === 'none' ? (
        <Card variant="tinted" className="flex flex-col items-start gap-4">
          <p className="text-lead">
            You have no saved quiz result yet. Take the quiz while signed in and
            your result is kept here.
          </p>
          <Button to="/quiz">Take the quiz</Button>
        </Card>
      ) : null}
      {result.status === 'unavailable' || result.status === 'signed_out' ? (
        <Card variant="tinted" className="flex flex-col items-start gap-4">
          <p role="status" className="text-lead">
            We could not load your saved quiz result just now. Your result is
            still kept on this device.
          </p>
          <Button to="/quiz" variant="outline">
            Open the quiz
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
