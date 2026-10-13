import {useEffect, useRef, useState} from 'react';
import {useFetchers} from 'react-router';
import {AlertIcon} from '~/components/ui/Icons';
import {
  isCartActionResult,
  readCartMessages,
  type CartMessage,
} from '~/lib/cart/messages';

/**
 * Shows what Shopify said about the last cart change: errors (userErrors) and warnings, such as a quantity
 * reduced to the stock left. The two live regions are always in the DOM, empty when there is nothing to
 * say, so screen readers announce text the moment it appears (WCAG 4.1.3). The newest result replaces the
 * previous one, so a later success clears an old error.
 */
export function CartMessages({className}: {className?: string}) {
  const fetchers = useFetchers();
  const [messages, setMessages] = useState<readonly CartMessage[]>([]);
  // Results that already existed when this component mounted are old news (for example a drawer opened
  // long after an earlier error); only results that arrive while it is mounted are shown.
  const seen = useRef<WeakSet<object> | null>(null);
  if (seen.current === null) {
    seen.current = new WeakSet();
    for (const fetcher of fetchers) {
      const data: unknown = fetcher.data;
      if (isCartActionResult(data)) seen.current.add(data);
    }
  }
  const known = seen.current;

  useEffect(() => {
    for (const fetcher of fetchers) {
      const data: unknown = fetcher.data;
      if (
        fetcher.state === 'idle' &&
        isCartActionResult(data) &&
        !known.has(data)
      ) {
        known.add(data);
        setMessages(readCartMessages(data));
      }
    }
  }, [fetchers, known]);

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
          onClick={() => setMessages([])}
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
