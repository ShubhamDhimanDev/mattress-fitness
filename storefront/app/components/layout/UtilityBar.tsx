import {Link} from 'react-router';
import {LazyBoundary} from '~/components/layout/LazyPanel';
import {chatPanel} from '~/components/layout/lazyPanels';
import {PhoneIcon} from '~/components/ui/Icons';
import {consentHandle} from '~/lib/analytics/gate';
import {
  UTILITY_LINKS,
  type SupportPhone,
  type UtilityLink,
} from '~/lib/navigation';

type UtilityBarProps = {
  /** The client's number; without one no phone link is rendered. */
  supportPhone?: SupportPhone | null;
  /** The links to show; the root loader leaves out those whose page does not exist (P6-09). */
  links?: readonly UtilityLink[];
};

const ChatPanel = chatPanel.Panel;

// Small bold labels use plain weights, not `type-display`: its tight tracking is too cramped at 13 px (REDESIGN_PRIMITIVES).
// 44 px high like every other target; the bar is therefore a little taller than the 38 px in the mock-up.
const LINK_CLASSES =
  'inline-flex min-h-touch items-center gap-1.5 font-semibold hover:underline';

/**
 * Thin ink bar above the main row (CR-31). From 1024 px it lists the utility links (track order, contact, chat) and
 * the phone number, which renders only when it is configured (B-15). Below 1024 px those live in the mobile menu,
 * which always lists them, so the bar is hidden there (BV-006). The bar carries `on-dark` so the focus ring is yellow on ink.
 */
export function UtilityBar({
  supportPhone = null,
  links = UTILITY_LINKS,
}: UtilityBarProps) {
  return (
    <div className="on-dark hidden bg-surface-inverse text-caption font-semibold text-white lg:block">
      <div className="mx-auto flex max-w-page items-center justify-center gap-4 px-4 md:px-10 lg:justify-end">
        <ul className="hidden shrink-0 items-center gap-x-6 lg:flex">
          {links.map((link) =>
            link.id === 'chat' ? (
              link.chat && (
                // A button for the provider's widget, not a link (P7-03); this instance also runs the chat's gate.
                <LazyBoundary key={link.id}>
                  <ChatPanel
                    className={LINK_CLASSES}
                    dense
                    links={links}
                    consent={consentHandle}
                  />
                </LazyBoundary>
              )
            ) : (
              <li key={link.id}>
                <Link to={link.to} className={LINK_CLASSES}>
                  {link.label}
                </Link>
              </li>
            ),
          )}
          {supportPhone ? (
            <li>
              <a href={supportPhone.href} className={LINK_CLASSES}>
                <PhoneIcon className="size-4" />
                <span className="sr-only">Call us: </span>
                {supportPhone.display}
              </a>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
