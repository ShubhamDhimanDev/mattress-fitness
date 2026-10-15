import {isRouteErrorResponse, useLocation, useRouteError} from 'react-router';
import {Button} from '~/components/ui/Button';
import {accountErrorView} from '~/lib/account/results';

/**
 * Error page for every account route (P6-07, P-L8). The text is fixed: the thrown error is never shown, in
 * development either, because the account loaders can hold customer data. Each view offers a way forward and
 * keeps the site header and footer, since the root layout stays mounted.
 */
export function AccountErrorBoundary() {
  const error = useRouteError();
  const location = useLocation();
  const view = accountErrorView(
    isRouteErrorResponse(error) ? error.status : null,
  );
  // A plain link (a new document request) retries with fresh data and a fresh session read.
  const retryHref = `${location.pathname}${location.search}`;

  return (
    <div role="alert" className="flex flex-col items-start gap-4 py-12">
      <h1 className="text-3xl font-bold">{view.title}</h1>
      <p className="text-base text-fg-muted">{view.message}</p>
      <div className="flex flex-wrap gap-3">
        {view.recovery === 'sign-in' ? (
          <Button href="/account/login" variant="pill">
            Sign in
          </Button>
        ) : null}
        {view.recovery === 'retry' ? (
          <Button href={retryHref} variant="pill">
            Try again
          </Button>
        ) : null}
        {view.recovery === 'account' ? (
          <Button href="/account" variant="pill">
            Back to your account
          </Button>
        ) : null}
        <Button to="/" variant="secondary">
          Back to the home page
        </Button>
      </div>
    </div>
  );
}
