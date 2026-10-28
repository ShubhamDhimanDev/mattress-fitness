import {
  isRouteErrorResponse,
  useRouteError,
  useRouteLoaderData,
} from 'react-router';
import {Button} from '~/components/ui/Button';
import {contactFallback} from '~/lib/chat/fallback';
import type {RootLoader} from '~/root';

export type ErrorPageViewProps = {
  status: number;
  title: string;
  message: string;
  /** Server error text. Shown only when the caller passes it, and the caller does that in development only. */
  detail?: string;
  /** The contact page, only when the store has one (the nav links say so); no link is shown otherwise. */
  contactHref?: string | null;
};

/**
 * A simple bed with a moon, drawn inline so the error page needs no image request. Decorative: the heading and
 * text carry the meaning, so it is hidden from assistive technology. Colours come from the theme through
 * `fill-*` and `stroke-*` utilities.
 */
export function SleepyBedIllustration({className}: {className?: string}) {
  return (
    <svg
      viewBox="0 0 320 200"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="248" cy="48" r="26" className="fill-accent-400" />
      <circle cx="260" cy="40" r="22" className="fill-paper" />
      <circle cx="64" cy="44" r="4" className="fill-primary-500" />
      <circle cx="116" cy="24" r="3" className="fill-ink-300" />
      <circle cx="190" cy="52" r="3" className="fill-ink-300" />
      <rect
        x="28"
        y="96"
        width="14"
        height="76"
        rx="6"
        className="fill-ink-900"
      />
      <rect
        x="278"
        y="120"
        width="14"
        height="52"
        rx="6"
        className="fill-ink-900"
      />
      <rect
        x="36"
        y="118"
        width="248"
        height="34"
        rx="12"
        className="fill-surface stroke-ink-900"
        strokeWidth="4"
      />
      <rect
        x="36"
        y="140"
        width="248"
        height="14"
        rx="6"
        className="fill-primary-500"
      />
      <rect
        x="52"
        y="98"
        width="64"
        height="26"
        rx="12"
        className="fill-surface stroke-ink-900"
        strokeWidth="4"
      />
      <path
        d="M44 172h232"
        className="stroke-ink-900"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The page for a missing page or a failed one: friendly heading, short text and three ways on (home, shop, contact).
 * Used by the catch-all route; the status code is set by whoever threw, not here.
 */
export function ErrorPageView({
  status,
  title,
  message,
  detail,
  contactHref = null,
}: ErrorPageViewProps) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-5 py-12 text-center md:py-20">
      <SleepyBedIllustration className="h-auto w-full max-w-xs" />
      <p className="text-caption font-bold tracking-wide text-fg-muted uppercase">
        Error {status}
      </p>
      <h1 className="type-display text-4xl md:text-5xl">{title}</h1>
      <p className="max-w-prose text-lead text-fg-muted">{message}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button to="/" size="lg">
          Back to the home page
        </Button>
        <Button to="/collections" size="lg" variant="outline">
          Shop mattresses
        </Button>
        {contactHref ? (
          <Button to={contactHref} size="lg" variant="outline">
            Contact us
          </Button>
        ) : null}
      </div>
      {detail ? (
        <pre className="max-w-full overflow-x-auto rounded-card bg-paper p-4 text-left text-sm">
          {detail}
        </pre>
      ) : null}
    </div>
  );
}

/**
 * The error boundary body for the content and store routes: a 404 (thrown by their loaders) reads "Page not found",
 * anything else a fixed "Something went wrong". The status code stays whatever the loader threw; this only draws it,
 * inside the site header and footer (the root layout stays mounted). Server error text is shown in development only.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  const root = useRouteLoaderData<RootLoader>('root');
  const isResponse = isRouteErrorResponse(error);
  const notFound = isResponse && error.status === 404;
  const detail =
    import.meta.env.DEV && isResponse && typeof error.data === 'string'
      ? error.data
      : '';
  return (
    <ErrorPageView
      status={isResponse ? error.status : 500}
      title={notFound ? 'Page not found' : 'Something went wrong'}
      message={
        notFound
          ? 'We could not find the page you were looking for.'
          : 'Please try again in a moment.'
      }
      detail={detail}
      contactHref={root ? contactFallback(root.utilityLinks) : null}
    />
  );
}
