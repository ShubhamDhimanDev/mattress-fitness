import {useSyncExternalStore} from 'react';
import {Link} from 'react-router';
import {Button} from '~/components/ui/Button';
import {hasProviders, type PublicAnalyticsConfig} from '~/lib/analytics/config';
import type {ConsentStore} from '~/lib/analytics/consent-store';

export const CONSENT_BANNER_LABEL = 'Privacy choices';
const PRIVACY_POLICY_PATH = '/policies/privacy-policy';

/**
 * The first-visit notice (NFR-011). Fixed to the bottom edge, so it covers part of the page but never moves it
 * (no layout shift), and it renders only on the client after hydration. It is not a modal: focus is not taken,
 * the page stays usable, and it sits before the header in the DOM so keyboard and screen-reader users meet it
 * early. "Accept all" and "Reject all" are the same size and both one press, so refusing is as easy as agreeing.
 * It shows only when a provider is configured and the shopper has not decided.
 */
export function ConsentBanner({
  config,
  store,
}: {
  config: PublicAnalyticsConfig;
  store: ConsentStore;
}) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  if (snapshot.decided || !hasProviders(config)) return null;

  const optOut = config.consentMode === 'opt-out';
  return (
    <div
      role="region"
      aria-label={CONSENT_BANNER_LABEL}
      className="fixed inset-x-0 bottom-0 z-40 flex flex-col gap-3 border-t border-line bg-surface p-4 shadow-lg md:inset-x-auto md:right-4 md:bottom-4 md:max-w-dialog md:rounded-panel md:border"
    >
      <p className="text-sm text-fg">
        {optOut
          ? 'We use analytics and advertising tools from Google and Meta to see how the site is used and to measure our advertising. You can turn them off at any time. '
          : 'We only load analytics and advertising tools from Google and Meta after you agree. '}
        <Link
          to={PRIVACY_POLICY_PATH}
          className="font-bold underline hover:text-primary-700"
        >
          Privacy policy
        </Link>
      </p>
      <div className="flex flex-col gap-2 md:flex-row">
        <Button
          variant="primary"
          size="sm"
          fullWidth
          onClick={() => store.acceptAll()}
        >
          Accept all
        </Button>
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          onClick={() => store.rejectAll()}
        >
          Reject all
        </Button>
        <Button
          variant="ghost"
          size="sm"
          fullWidth
          onClick={() => store.openPreferences()}
        >
          Choose
        </Button>
      </div>
    </div>
  );
}
