import type {ReactNode} from 'react';
import {Link} from 'react-router';
import {ChatIcon, PhoneIcon} from '~/components/ui/Icons';
import {SUPPORT_PHONE, UTILITY_LINKS} from '~/lib/navigation';

type UtilityBarProps = {
  /** Left side: the delivery ZIP control and the my-store link. */
  children: ReactNode;
};

const LINK_CLASSES =
  'inline-flex min-h-touch items-center gap-1 hover:underline';

/** Grey bar above the main row. The right-hand links are hidden below 768 px and appear in the mobile menu. */
export function UtilityBar({children}: UtilityBarProps) {
  return (
    <div className="bg-surface-muted text-sm text-ink-700">
      <div className="mx-auto flex max-w-page items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4">
          {children}
        </div>
        <ul className="hidden shrink-0 items-center gap-x-4 md:flex">
          {UTILITY_LINKS.map((link) => (
            <li key={link.id}>
              <Link to={link.to} className={LINK_CLASSES}>
                {link.id === 'chat' ? <ChatIcon className="size-4" /> : null}
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <a href={SUPPORT_PHONE.href} className={LINK_CLASSES}>
              <PhoneIcon className="size-4" />
              <span className="sr-only">Call us: </span>
              {SUPPORT_PHONE.display}
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
