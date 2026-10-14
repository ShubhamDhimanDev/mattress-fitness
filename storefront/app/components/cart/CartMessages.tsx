import {useMemo, useState} from 'react';
import {
  currentCartResultSeq,
  useLatestCartResult,
} from '~/components/cart/cart-results';
import {AlertIcon} from '~/components/ui/Icons';
import {readCartMessages, type CartMessage} from '~/lib/cart/messages';

/**
 * Shows what Shopify said about the last cart change: errors (userErrors) and warnings, such as a quantity
 * reduced to the stock left. The two live regions are always in the DOM, empty when there is nothing to
 * say, so screen readers announce text the moment it appears (WCAG 4.1.3). The newest result replaces the
 * previous one, so a later success clears an old error. Results come from the forms that submitted them
 * (cart-results.ts, B-20), not from useFetchers(), which never lists a finished fetcher.
 */
export function CartMessages({className}: {className?: string}) {
  const {seq, data} = useLatestCartResult();
  // Results that already existed when this component mounted are old news (for example a drawer opened
  // long after an earlier error); only results that arrive while it is mounted are shown.
  const [mountedAt] = useState(currentCartResultSeq);
  const [dismissedAt, setDismissedAt] = useState(0);
  const messages = useMemo<readonly CartMessage[]>(
    () => (seq > mountedAt && seq > dismissedAt ? readCartMessages(data) : []),
    [seq, data, mountedAt, dismissedAt],
  );

  const errors = messages.filter((message) => message.kind === 'error');
  const warnings = messages.filter((message) => message.kind === 'warning');

  return (
    <div className={className}>
      <div role="alert">
        {errors.map((message) => (
          <MessageRow key={message.text} message={message} />
        ))}
      </div>
      <div role="status">
        {warnings.map((message) => (
          <MessageRow key={message.text} message={message} />
        ))}
      </div>
      {messages.length > 0 ? (
        <button
          type="button"
          onClick={() => setDismissedAt(seq)}
          className="min-h-touch text-sm text-primary-700 underline underline-offset-2"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

function MessageRow({message}: {message: CartMessage}) {
  const isError = message.kind === 'error';
  return (
    <p
      className={
        isError
          ? 'mb-2 flex items-start gap-2 rounded-choice bg-error-bg p-3 text-sm font-bold text-error-fg'
          : 'mb-2 flex items-start gap-2 rounded-choice bg-warning-bg p-3 text-sm text-warning-fg'
      }
    >
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      <span>
        <span className="sr-only">{isError ? 'Error: ' : 'Notice: '}</span>
        {message.text}
      </span>
    </p>
  );
}
