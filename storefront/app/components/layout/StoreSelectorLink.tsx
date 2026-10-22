import {Link} from 'react-router';
import {MapPinIcon} from '~/components/ui/Icons';
import {STORE_LOCATOR_PATH} from '~/lib/navigation';

type StoreSelectorLinkProps = {
  /** Name of the shopper's chosen store, or null/undefined when none is chosen. */
  storeName?: string | null;
  /** Where choosing or changing the store happens; the locator pages arrive in Phase 6. */
  to?: string;
};

/**
 * "My store" entry point in the utility bar (REQ-LOC-003). Props-driven: the root loader validates the
 * my_store cookie against the store list and passes the name (P3B-10); with no valid selection it reads
 * "Select your store".
 */
export function StoreSelectorLink({
  storeName,
  to = STORE_LOCATOR_PATH,
}: StoreSelectorLinkProps) {
  const label = storeName ? `My store: ${storeName}` : 'Select your store';

  // The text truncates with an ellipsis when the bar is full (BV-013); the DOM text stays whole, so the accessible name
  // is the full label, and the title shows it to pointer users.
  return (
    <Link
      to={to}
      title={label}
      className="inline-flex max-w-xs min-h-touch min-w-0 items-center gap-2 font-bold underline underline-offset-2 hover:no-underline"
    >
      <MapPinIcon className="size-5 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
