import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Link} from 'react-router';
import {Button} from '~/components/ui/Button';
import {
  configuredCategories,
  type PublicAnalyticsConfig,
} from '~/lib/analytics/config';
import type {ConsentStore} from '~/lib/analytics/consent-store';

export const CONSENT_BANNER_LABEL = 'Privacy choices';
export const CONSENT_BANNER_ANNOUNCEMENT = 'Cookie choices available';

/**
 * The sentence names only the tools that are configured: Google when GA4 is set, Meta when the pixel is, both when
 * both are. It claims nothing about Shopify's own analytics, which follows Shopify's settings (docs/integrations/ANALYTICS.md).
 */
export function bannerSentence(
  config: PublicAnalyticsConfig,
  optOut: boolean,
): string {
  const categories = configuredCategories(config);
  const analytics = categories.includes('analytics');
  const marketing = categories.includes('marketing');
  const tools = [
    ...(analytics ? ['analytics tools from Google'] : []),
    ...(marketing ? ['advertising tools from Meta'] : []),
  ].join(' and ');
  if (!optOut) return `We only load ${tools} after you agree. `;
  const purposes = [
    ...(analytics ? ['see how the site is used'] : []),
    ...(marketing ? ['measure our advertising'] : []),
  ].join(' and ');
  return `We use ${tools} to ${purposes}. You can turn ${categories.length > 1 ? 'them' : 'it'} off at any time. `;
}

/**
 * While the banner covers the bottom edge, a focused element must not end up under it (WCAG 2.4.11). The browser
 * keeps scrolled-to elements clear of `scroll-padding`, so the banner's height is set as the bottom scroll padding of
 * the page for as long as it is shown, and put back when it goes. Set inline, so no style sheet changes.
 */
function useScrollPaddingWhileShown(element: HTMLElement | null) {
  useEffect(() => {
    if (!element) return;
    const root = document.documentElement;
    const before = root.style.scrollPaddingBottom;
    const apply = () => {
      root.style.scrollPaddingBottom = `${element.offsetHeight + 16}px`;
    };
    apply();
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.scrollPaddingBottom = before;
    };
  }, [element]);
}
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
  const [element, setElement] = useState<HTMLElement | null>(null);
  const shown = !snapshot.decided && configuredCategories(config).length > 0;
  useScrollPaddingWhileShown(shown ? element : null);

  // A polite message, set a moment after the banner appears so assistive technology announces it, once. Focus stays
  // where it was.
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef(false);
  useEffect(() => {
    if (!shown || announced.current) return;
    announced.current = true;
    const timer = setTimeout(
      () => setAnnouncement(CONSENT_BANNER_ANNOUNCEMENT),
      100,
    );
    return () => clearTimeout(timer);
  }, [shown]);

  if (!shown) return null;

  const optOut = config.consentMode === 'opt-out';
  return (
    <div
      ref={setElement}
      data-consent="banner"
      role="region"
      aria-label={CONSENT_BANNER_LABEL}
      className="fixed inset-x-0 bottom-0 z-40 flex flex-col gap-3 border-t border-line bg-surface p-4 shadow-lg md:inset-x-auto md:right-4 md:bottom-4 md:max-w-dialog md:rounded-panel md:border"
    >
      <p className="text-sm text-fg">
        {bannerSentence(config, optOut)}
        <Link
          to={PRIVACY_POLICY_PATH}
          className="font-bold underline hover:text-primary-700"
        >
          Privacy policy
        </Link>
      </p>
      <div role="status" className="sr-only">
        {announcement}
      </div>
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
