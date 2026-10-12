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
 * "My store" entry point in the utility bar (REQ-LOC-003). Props-driven: the persisted selection and the
 * store records come from Shopify later (P3B-10); until then it always reads "Select your store".
 */
export function StoreSelectorLink({
  storeName,
  to = STORE_LOCATOR_PATH,
}: StoreSelectorLinkProps) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-touch min-w-0 items-center gap-2 font-bold hover:underline"
    >
      <MapPinIcon className="size-5" />
      <span className="truncate">
        {storeName ? `My store: ${storeName}` : 'Select your store'}
      </span>
    </Link>
  );
}
