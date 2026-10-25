import type {ReactNode} from 'react';
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
  /** Left side: the delivery ZIP control and the my-store link. */
  children: ReactNode;
  /** The client's number; without one no phone link is rendered. */
  supportPhone?: SupportPhone | null;
  /** The links to show; the root loader leaves out those whose page does not exist (P6-09). */
  links?: readonly UtilityLink[];
};

const ChatPanel = chatPanel.Panel;

const LINK_CLASSES =
  'inline-flex min-h-touch items-center gap-1 hover:underline';

/**
 * Grey bar above the main row. The right-hand links need about 870 px beside the ZIP and store controls, so they show
 * from 1024 px (where the menu button gives way to the full navigation); below that they are in the mobile menu, which
 * always lists them, and the bar stays one line at 768 px (BV-006).
 */
export function UtilityBar({
  children,
  supportPhone = null,
  links = UTILITY_LINKS,
}: UtilityBarProps) {
  return (
    <div className="bg-surface-muted text-sm text-ink-700">
      <div className="mx-auto flex max-w-page items-center justify-between gap-4 px-4 md:px-6">
        {/* Below lg the group may wrap to a second row; from lg it stays on one row and the store name truncates (BV-013). */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 lg:flex-nowrap">
          {children}
        </div>
        <ul className="hidden shrink-0 items-center gap-x-4 lg:flex">
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
