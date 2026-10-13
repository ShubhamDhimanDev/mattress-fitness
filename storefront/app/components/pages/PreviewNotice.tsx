import {AlertIcon} from '~/components/ui/Icons';

type PreviewNoticeProps = {
  /** What is sample data on this page, for example "products" or "stores". */
  subject: string;
};

/**
 * Shown only while a page reads the synthetic fixtures (app/lib/pages/data-source.ts). The brands, products
 * and stores are invented (NFR-007), so the page must say it is a preview. Removed from the output once the
 * Storefront API queries replace the fixtures (P3B-01, P3A-07).
 */
export function PreviewNotice({subject}: PreviewNoticeProps) {
  return (
    <aside
      aria-label="Preview notice"
      className="flex items-start gap-2 rounded-card border-2 border-warning-fg bg-warning-bg p-4 text-sm text-warning-fg"
    >
      <AlertIcon className="mt-0.5 size-5" />
      <p>
        <strong>Preview data.</strong> The {subject} on this page are samples
        from fictional brands, shown until the store is connected.
      </p>
    </aside>
  );
}
