import type {ReactNode} from 'react';
import {Link} from 'react-router';
import type {PromoMessage} from '~/lib/navigation';

type PromoBarProps = {
  /** Null or undefined hides the bar. The message is edited in Shopify admin (`site_settings`, P3B-13). */
  message?: PromoMessage | null;
};

const LINK_CLASSES =
  'inline-flex min-h-touch items-center underline underline-offset-2 hover:no-underline';

/** Site paths use the router; another site opens as a plain anchor (the target is allow-listed upstream). */
function PromoLink({
  message,
  children,
}: {
  message: PromoMessage & {to: string};
  children: ReactNode;
}) {
  if (message.external === true) {
    return (
      <a href={message.to} rel="noopener noreferrer" className={LINK_CLASSES}>
        {children}
      </a>
    );
  }
  return (
    <Link to={message.to} className={LINK_CLASSES}>
      {children}
    </Link>
  );
}

/**
 * One-line promotion above the header. Plain text plus an optional link; never HTML from Shopify. With a link
 * and no label the whole message is the link, so a link typed in admin works without a second field.
 */
export function PromoBar({message}: PromoBarProps) {
  if (!message || message.text.trim() === '') return null;
  const to = message.to;
  const linked = to === undefined ? null : {...message, to};
  return (
    <div className="bg-accent-400 text-ink-900">
      <p className="mx-auto flex max-w-page flex-wrap items-center justify-center gap-x-3 px-4 text-center text-sm font-bold md:px-6">
        {linked && !message.linkLabel ? (
          <PromoLink message={linked}>{message.text}</PromoLink>
        ) : (
          <span className="py-2">{message.text}</span>
        )}
        {linked && message.linkLabel ? (
          <PromoLink message={linked}>{message.linkLabel}</PromoLink>
        ) : null}
      </p>
    </div>
  );
}
