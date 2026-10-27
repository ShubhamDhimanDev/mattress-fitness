import {isRouteErrorResponse, useLocation, useRouteError} from 'react-router';
import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {AlertIcon} from '~/components/ui/Icons';
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
    <Card
      role="alert"
      variant="raised"
      className="mx-auto my-12 flex max-w-xl flex-col items-start gap-4"
    >
      <span className="flex size-12 items-center justify-center rounded-pill bg-error-bg text-error-fg">
        <AlertIcon className="size-7" />
      </span>
      <h1 className="type-display text-3xl md:text-4xl">{view.title}</h1>
      <p className="text-lead text-fg-muted">{view.message}</p>
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
        <Button to="/" variant="outline">
          Back to the home page
        </Button>
      </div>
    </Card>
  );
}
