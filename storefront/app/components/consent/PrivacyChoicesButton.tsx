import {useSyncExternalStore} from 'react';
import {cn} from '~/components/ui/cn';
import {consentHandle} from '~/lib/analytics/gate';

/**
 * "Privacy choices": reopens the preferences so consent can be withdrawn as easily as it was given (NFR-011).
 * Sits with the footer's legal links, so it is part of every route's JavaScript and imports nothing heavy. Renders
 * nothing while no analytics provider is configured (no store is ever published then), and nothing until the consent
 * chunk has loaded after hydration and published its store. The store is read with `useSyncExternalStore` and a server
 * snapshot of "none", so the server HTML and the hydrating render agree without a wrapper.
 */
export function PrivacyChoicesButton({className}: {className?: string}) {
  const store = useSyncExternalStore(
    consentHandle.subscribe,
    consentHandle.getStore,
    consentHandle.getNoStore,
  );
  if (!store) return null;
  return (
    <button
      type="button"
      onClick={() => store.openPreferences()}
      className={cn(
        'inline-flex min-h-touch items-center text-sm text-ink-700 hover:text-primary-700 hover:underline',
        className,
      )}
    >
      Privacy choices
    </button>
  );
}
