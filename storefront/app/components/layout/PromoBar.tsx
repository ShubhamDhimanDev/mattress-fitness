import type {ReactNode} from 'react';
import {Link} from 'react-router';
import type {PromoMessage} from '~/lib/navigation';

type PromoBarProps = {
  /** Null or undefined hides the bar. The message is edited in Shopify admin (`site_settings`, P3B-13). */
  message?: PromoMessage | null;
};

// The text and the link share one height (44 px, the touch target) so the bar does not change size when a link
// is added in admin. There is no `target="_blank"`: another site opens in the same tab like every other link, so
// no "opens in a new tab" cue is needed (WCAG 3.2.5 is met by not changing context unexpectedly).
const BOX_CLASSES = 'inline-flex min-h-touch items-center';
const LINK_CLASSES = `${BOX_CLASSES} underline underline-offset-2 hover:no-underline`;

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
          <span className={BOX_CLASSES}>{message.text}</span>
        )}
        {linked && message.linkLabel ? (
          <PromoLink message={linked}>{message.linkLabel}</PromoLink>
        ) : null}
      </p>
    </div>
  );
}
