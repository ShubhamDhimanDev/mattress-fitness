import {Link} from 'react-router';
import {cn} from '~/components/ui/cn';
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

// The text is free text from Shopify admin and only 13 to 14 px high, so it uses plain bold type in sentence case, never
// `type-display` (its tight tracking is too cramped at this size) and never capitals.
const TEXT_CLASSES = 'text-caption font-extrabold md:text-sm';

/** Site paths use the router; another site opens as a plain anchor (the target is allow-listed upstream). */
function PromoLink({
  message,
  label,
}: {
  message: PromoMessage & {to: string};
  label: string;
}) {
  const className = cn(LINK_CLASSES, TEXT_CLASSES);
  if (message.external === true) {
    return (
      <a href={message.to} rel="noopener noreferrer" className={className}>
        {label}
      </a>
    );
  }
  return (
    <Link to={message.to} className={className}>
      {label}
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
    <div className="on-dark bg-primary-500 text-white">
      <p className="mx-auto flex max-w-page flex-wrap items-center justify-center gap-x-3 px-4 text-center md:px-10">
        {linked && !message.linkLabel ? (
          <PromoLink message={linked} label={message.text} />
        ) : (
          <span className={cn(BOX_CLASSES, TEXT_CLASSES)}>{message.text}</span>
        )}
        {linked && message.linkLabel ? (
          <PromoLink message={linked} label={message.linkLabel} />
        ) : null}
      </p>
    </div>
  );
}
