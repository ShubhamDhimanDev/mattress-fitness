import {Link} from 'react-router';
import type {BrandLink} from '~/lib/shopify/brand-link';

const NAME_CLASSES = 'text-sm font-bold tracking-wide text-fg-muted uppercase';

/**
 * The brand or vendor line above the product title. A link to the brand page when the loader found one
 * (`brandLink`), otherwise the same words as plain text.
 */
export function VendorName({
  vendor,
  brandLink,
}: {
  vendor: string;
  brandLink: BrandLink | null;
}) {
  if (!brandLink) return <p className={NAME_CLASSES}>{vendor}</p>;
  return (
    <p className={NAME_CLASSES}>
      <Link
        to={brandLink.to}
        prefetch="intent"
        className="inline-flex min-h-touch items-center hover:text-primary-700 hover:underline"
      >
        {vendor}
      </Link>
    </p>
  );
}
