import {Link} from 'react-router';
import type {PromoMessage} from '~/lib/navigation';

type PromoBarProps = {
  /** Null or undefined hides the bar. The message is edited in Shopify admin once P3B-13 lands. */
  message?: PromoMessage | null;
};

/** One-line promotion above the header. Plain text plus an optional link; never HTML from Shopify. */
export function PromoBar({message}: PromoBarProps) {
  if (!message) return null;
  return (
    <div className="bg-accent-400 text-ink-900">
      <p className="mx-auto flex max-w-page flex-wrap items-center justify-center gap-x-3 px-4 text-center text-sm font-bold md:px-6">
        <span className="py-2">{message.text}</span>
        {message.to && message.linkLabel ? (
          <Link
            to={message.to}
            className="inline-flex min-h-touch items-center underline underline-offset-2 hover:no-underline"
          >
            {message.linkLabel}
          </Link>
        ) : null}
      </p>
    </div>
  );
}
