// Email (and optional text-message) signup, POST only (REQ-ANL-003, P7-02, NFR-011, NFR-013, T-13, T-16).
// UNVERIFIED against Klaviyo: no account, key or list exists yet (CLR-004, Q-015); see docs/integrations/KLAVIYO.md.
//
//   POST /signup  the submission, handled in app/lib/signup/handler.ts: same origin only, rate limited per client and per
//                 mailbox, a honeypot, a generic "thank you" that does not say whether the address was already known,
//                 one Klaviyo call with a timeout, no personal data in logs.
//   GET  /signup  405 with a pointer to the forms. There is nothing to look at, nothing is read from the URL, and the
//                 page is noindex.
// The forms live in the footer and on the home page (components/signup). With JavaScript they submit through a fetcher
// and the answer appears in place; without it the browser posts here and this page shows the answer.
import {data, useActionData, type HeadersFunction} from 'react-router';
import type {Route} from './+types/signup';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {noStoreHeaders} from '~/lib/cart/http';
import {handleSignup, signupDepsFromEnv} from '~/lib/signup/handler';
import type {SignupResponse} from '~/lib/signup/shared';

export const meta: Route.MetaFunction = () => [
  {title: formatPageTitle('Email signup')},
  {name: 'robots', content: 'noindex, nofollow'},
];

// A per-shopper answer: no shared cache may keep it. The action's own headers (Retry-After, X-Robots-Tag, Allow) are kept.
export const headers: HeadersFunction = ({actionHeaders, loaderHeaders}) => {
  const merged = noStoreHeaders(loaderHeaders);
  actionHeaders.forEach((value, name) => merged.set(name, value));
  merged.set('X-Robots-Tag', 'noindex, nofollow');
  return merged;
};

export function loader() {
  // Reads nothing from the request: a link cannot start a signup or pre-fill anything.
  return data(null, {
    status: 405,
    headers: noStoreHeaders({Allow: 'POST'}),
  });
}

export async function action({request, context}: Route.ActionArgs) {
  const result = await handleSignup(
    request,
    // The placeholder SMS wording may be shown in development only (config.ts).
    signupDepsFromEnv(context.env, {allowUnapprovedSms: import.meta.env.DEV}),
  );
  return data<SignupResponse>(result.response, {
    status: result.status,
    headers: result.headers,
  });
}

function fieldMessages(response: SignupResponse): string[] {
  return response.status === 'invalid'
    ? Object.values(response.errors).filter(
        (message): message is string => typeof message === 'string',
      )
    : [];
}

/** The page a browser without JavaScript lands on after posting a form, and where a stray GET ends. */
export default function SignupPage() {
  const posted = useActionData<typeof action>();
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-8">
      <h1 className="type-display text-4xl md:text-5xl">Email signup</h1>
      <Card
        variant="tinted"
        role="status"
        className="flex flex-col gap-2 text-lead"
      >
        {posted === undefined ? (
          <p className="text-fg-muted">
            To sign up, use the form at the bottom of any page.
          </p>
        ) : (
          <>
            <p>{posted.message}</p>
            {fieldMessages(posted).length > 0 ? (
              <ul className="list-disc pl-6">
                {fieldMessages(posted).map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </Card>
      <div>
        <Button to="/" size="lg">
          Back to the home page
        </Button>
      </div>
    </div>
  );
}
