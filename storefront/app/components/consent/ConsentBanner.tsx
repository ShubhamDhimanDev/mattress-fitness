import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Link} from 'react-router';
import {Button} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
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
 * While the banner covers the bottom edge the page makes room for it (WCAG 2.4.11 Focus Not Obscured, 1.4.10 Reflow):
 *  - the banner's height is added as REAL bottom padding of the body, so the end of the document, with its footer
 *    links, can be scrolled clear of the fixed banner (scroll padding alone does nothing at the end of the document);
 *  - the same height is set as the page's bottom scroll padding, so a focused element scrolled into view stays clear.
 * Both are set inline (no style sheet changes), updated when the banner resizes or the window does, and put back as
 * they were when the banner goes. The body's own padding, if any, is kept and the banner's height added to it.
 */
function useRoomForBannerWhileShown(element: HTMLElement | null) {
  useEffect(() => {
    if (!element) return;
    const root = document.documentElement;
    const body = document.body;
    const scrollBefore = root.style.scrollPaddingBottom;
    const paddingBefore = body.style.paddingBottom;
    const basePadding = parseFloat(getComputedStyle(body).paddingBottom) || 0;
    const apply = () => {
      const room = element.offsetHeight + 16;
      root.style.scrollPaddingBottom = `${room}px`;
      body.style.paddingBottom = `${basePadding + room}px`;
    };
    apply();
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
    observer?.observe(element);
    window.addEventListener('resize', apply);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', apply);
      root.style.scrollPaddingBottom = scrollBefore;
      body.style.paddingBottom = paddingBefore;
    };
  }, [element]);
}

/** A narrow or short window (a phone in landscape, 400 percent zoom): the banner switches to a compact layout. */
const COMPACT_QUERY = '(max-width: 360px), (max-height: 400px)';

function subscribeCompact(listener: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const list = window.matchMedia(COMPACT_QUERY);
  list.addEventListener('change', listener);
  return () => list.removeEventListener('change', listener);
}

function isCompact(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(COMPACT_QUERY).matches
  );
}

/** The most of the window the banner may take; the text scrolls inside it, the buttons never do. */
export const BANNER_MAX_HEIGHT = '40dvh';
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
  useRoomForBannerWhileShown(shown ? element : null);
  const compact = useSyncExternalStore(
    subscribeCompact,
    isCompact,
    () => false,
  );

  // A polite message, set a moment after the banner appears so assistive technology announces it, once. Focus stays
  // where it was.
  const [announcement, setAnnouncement] = useState('');
  // Marked as done only when the message is actually set, so an effect that is cleaned up and run again at once (React
  // StrictMode in development) schedules the timer again instead of finding it already spent.
  const announced = useRef(false);
  useEffect(() => {
    if (!shown || announced.current) return;
    const timer = setTimeout(() => {
      announced.current = true;
      setAnnouncement(CONSENT_BANNER_ANNOUNCEMENT);
    }, 100);
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
      data-compact={compact ? '' : undefined}
      style={{maxHeight: BANNER_MAX_HEIGHT}}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex flex-col border-t border-line bg-surface shadow-lg md:inset-x-auto md:right-4 md:bottom-4 md:max-w-dialog md:rounded-panel md:border',
        compact ? 'gap-2 p-2' : 'gap-3 p-4',
      )}
    >
      {/* The text is the part that scrolls when the window is small; the link inside keeps the region keyboard-reachable. */}
      <p
        className={cn(
          'min-h-0 overflow-y-auto text-fg',
          compact ? 'text-xs' : 'text-sm',
        )}
      >
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
      <div
        className={cn(
          'flex shrink-0 gap-2',
          compact ? 'flex-row' : 'flex-col md:flex-row',
        )}
      >
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
