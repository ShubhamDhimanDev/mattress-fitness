import {useNavigation} from 'react-router';
import {useDelayedFlag} from '~/lib/use-delayed-flag';

/**
 * A thin bar across the top of the window while the next page is loading. React Router keeps the old page on screen until
 * the new route's loader has answered, so on a slow connection a click would otherwise look like nothing happened.
 * It follows every navigation (links, filters, search, form posts) and ignores cart fetchers, which show their own busy
 * state on the button that was pressed. It appears only after 150 ms and stays at least 400 ms (see `useDelayedFlag`), so a
 * fast page change shows nothing and a medium one does not blink. It sits above the drawers (`z-50`) so a link inside the
 * cart drawer still gets feedback. With reduced motion the bar is a still, full-width stripe instead of a sliding one.
 */
export function NavigationProgress() {
  const navigation = useNavigation();
  const visible = useDelayedFlag(navigation.state !== 'idle');

  return (
    <>
      {visible ? (
        <div
          aria-hidden="true"
          data-navigation-progress=""
          className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-1 overflow-hidden bg-primary-100"
        >
          <div className="h-full w-full bg-primary-500 motion-safe:w-2/5 motion-safe:animate-nav-progress" />
        </div>
      ) : null}
      {/* Always mounted, so a screen reader that is watching it hears the text appear and clear. */}
      <p role="status" className="sr-only">
        {visible ? 'Loading page' : ''}
      </p>
    </>
  );
}
