import {useSyncExternalStore} from 'react';
import {useConsent} from '~/components/consent/consent-context';
import {cn} from '~/components/ui/cn';
import {consentHandle} from '~/lib/analytics/gate';

/**
 * "Privacy choices": reopens the preferences so consent can be withdrawn as easily as it was given (NFR-011).
 * Sits with the footer's legal links, so it is part of every route's JavaScript and imports nothing heavy. Renders
 * nothing while no analytics provider is configured, because there is then nothing to choose, and nothing until the
 * consent chunk has loaded after hydration and published its store (the store does not exist before that).
 *
 * The store comes from `consentHandle`; a `ConsentContext` provider (tests, isolated components) overrides it.
 */
export function PrivacyChoicesButton({className}: {className?: string}) {
  const override = useConsent();
  const published = useSyncExternalStore(
    consentHandle.subscribe,
    consentHandle.getStore,
    consentHandle.getNoStore,
  );
  const store = override ? override.store : published;
  if (!store) return null;
  // The published store exists only when a provider is configured; an override carries its own configuration.
  if (
    override &&
    override.config.ga4MeasurementId === null &&
    override.config.metaPixelId === null
  ) {
    return null;
  }
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
