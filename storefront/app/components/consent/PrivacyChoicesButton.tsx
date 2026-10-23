import {useConsent} from '~/components/consent/consent-context';
import {cn} from '~/components/ui/cn';
import {hasProviders} from '~/lib/analytics/config';

/**
 * "Privacy choices": reopens the preferences so consent can be withdrawn as easily as it was given (NFR-011).
 * Place it with the footer's legal links. Renders nothing while no analytics provider is configured, because
 * there is then nothing to choose, and nothing on the server (the dialog is client-only).
 */
export function PrivacyChoicesButton({className}: {className?: string}) {
  const consent = useConsent();
  if (!consent?.store || !hasProviders(consent.config)) return null;
  const {store} = consent;
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
