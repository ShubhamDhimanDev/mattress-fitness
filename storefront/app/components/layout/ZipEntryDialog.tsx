import {useRef} from 'react';
import {LazyBoundary, PanelFailed} from '~/components/layout/LazyPanel';
import {zipFormPanel} from '~/components/layout/lazyPanels';
import {Dialog} from '~/components/ui/Dialog';
import {Skeleton} from '~/components/ui/Skeleton';
import {DELIVERY_ERROR_TEXT} from '~/lib/delivery-runtime/response';

// The same validator and wording as the server and the product-page and cart ZIP check (P3B-11).
export const ZIP_ERROR_MESSAGE = DELIVERY_ERROR_TEXT['invalid-zip'];

type ZipEntryDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The saved ZIP, if any. */
  initialZip?: string | null;
  /** Called with a ZIP that passed the shared check. The caller saves it on the server (P3B-11). */
  onSubmit: (zip: string) => void;
  onClear: () => void;
  /** An error the server answered with, shown under the field until the shopper edits it. */
  serverError?: string;
};

const ZipFormPanel = zipFormPanel.Panel;

/**
 * Delivery ZIP entry (REQ-NAV-003). Presentational: it validates the shape and reports; it stores nothing.
 * The dialog frame is static; the form arrives as a lazy chunk (P7-06) that the ZIP control preloads when the
 * shopper points at, focuses or presses its button, so it is normally ready by the time the dialog opens.
 */
export function ZipEntryDialog({
  open,
  onClose,
  initialZip,
  onSubmit,
  onClear,
  serverError,
}: ZipEntryDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delivery ZIP code"
      description="We use your ZIP code to show delivery options for your area."
      initialFocusRef={inputRef}
    >
      <LazyBoundary
        loading={<ZipFormSkeleton />}
        failed={<PanelFailed linkText="Reload the page" />}
      >
        <ZipFormPanel
          inputRef={inputRef}
          initialZip={initialZip ?? ''}
          onSubmit={onSubmit}
          onClear={onClear}
          serverError={serverError}
        />
      </LazyBoundary>
    </Dialog>
  );
}

// About the height of the real form (label, field and hint, then the button), so the dialog does not jump.
function ZipFormSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
