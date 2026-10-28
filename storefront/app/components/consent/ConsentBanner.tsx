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
    const apply = () => {
      // The body's own padding is read afresh each time (a breakpoint can change it), with our inline value taken off.
      body.style.paddingBottom = paddingBefore;
      const basePadding = parseFloat(getComputedStyle(body).paddingBottom) || 0;
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
  // Before Safari 14 a MediaQueryList has no addEventListener, only the older addListener.
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', listener);
    return () => list.removeEventListener('change', listener);
  }
  list.addListener(listener);
  return () => list.removeListener(listener);
}

function isCompact(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(COMPACT_QUERY).matches
  );
}

/**
 * A cue that the text scrolls (QA-ANL-3), shown only while there is more to read in that direction: the classic
 * "scroll shadows" (a shadow at an edge that fades once the text is scrolled to it, `local` attachment) painted from
 * the theme's own colours, plus a thin scrollbar where the browser draws one. Inline, so the style sheet is unchanged.
 */
const SCROLL_CUE_STYLE = {
  backgroundImage: [
    'linear-gradient(var(--color-surface) 30%, transparent)',
    'linear-gradient(transparent, var(--color-surface) 70%)',
    'radial-gradient(farthest-side at 50% 0, color-mix(in srgb, var(--color-ink-900) 25%, transparent), transparent)',
    'radial-gradient(farthest-side at 50% 100%, color-mix(in srgb, var(--color-ink-900) 25%, transparent), transparent)',
  ].join(', '),
  backgroundRepeat: 'no-repeat',
  backgroundSize: '100% 24px, 100% 24px, 100% 8px, 100% 8px',
  backgroundPosition: 'top, bottom, top, bottom',
  backgroundAttachment: 'local, local, scroll, scroll',
  scrollbarWidth: 'thin',
  // The scrollport is the padding box, so the padding above does not count when the browser scrolls a focused link into
  // view: without this, at 400 % zoom the link's bottom meets the scroller's edge and the focus ring is clipped (QA-ANL-4).
  scrollPaddingBlock: '6px',
} as const;

/** The most of the window the banner may take; the text scrolls inside it, the buttons never do. */
export const BANNER_MAX_HEIGHT = '40dvh';
/** Where the privacy link goes when the caller says nothing; the shell passes the real target (null hides the link). */
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
  privacyPath = PRIVACY_POLICY_PATH,
}: {
  config: PublicAnalyticsConfig;
  store: ConsentStore;
  /**
   * The privacy policy page that exists (the Shopify policy, or a page with the same handle), from the shell's content
   * availability data (P6-09). Null when neither exists: the sentence then ends without a link rather than linking a 404.
   */
  privacyPath?: string | null;
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
        'fixed inset-x-0 bottom-0 z-40 flex flex-col border-t border-line bg-surface shadow-lift md:inset-x-auto md:right-4 md:bottom-4 md:max-w-dialog md:rounded-panel md:border',
        compact ? 'gap-2 p-2' : 'gap-3 p-4',
      )}
    >
      {/* The text is the part that scrolls when the window is small. Its padding (and the matching negative margin, as in the gallery strip) leaves room for the link's focus ring, a 3 px outline 2 px off the link, which an `overflow` box would otherwise clip (QA-ANL-2). The link inside also keeps the region keyboard-reachable. */}
      <div
        data-scroll-cue=""
        style={SCROLL_CUE_STYLE}
        className="-m-1.5 min-h-0 overflow-y-auto p-1.5"
      >
        <p className={cn('text-fg', compact ? 'text-xs' : 'text-sm')}>
          {bannerSentence(config, optOut)}
          {privacyPath === null ? null : (
            <Link
              to={privacyPath}
              className="font-bold underline hover:text-primary-700"
            >
              Privacy policy
            </Link>
          )}
        </p>
      </div>
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
          className="min-w-0"
          aria-label={compact ? 'Accept all' : undefined}
          onClick={() => store.acceptAll()}
        >
          {compact ? <span className="text-xs">Accept</span> : 'Accept all'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          fullWidth
          className="min-w-0"
          aria-label={compact ? 'Reject all' : undefined}
          onClick={() => store.rejectAll()}
        >
          {compact ? <span className="text-xs">Reject</span> : 'Reject all'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          fullWidth
          className="min-w-0"
          onClick={() => store.openPreferences()}
        >
          {compact ? <span className="text-xs">Choose</span> : 'Choose'}
        </Button>
      </div>
    </div>
  );
}
