import {useEffect, useRef, useState} from 'react';
import {TruckIcon} from '~/components/ui/Icons';
import {zipFormPanel} from '~/components/layout/lazyPanels';
import {ZipEntryDialog} from '~/components/layout/ZipEntryDialog';

type DeliveryZipControlProps = {
  /** The shopper's saved delivery ZIP, or null. */
  zip: string | null;
  onSubmit: (zip: string) => void;
  onClear: () => void;
  /**
   * True while a save or clear is on its way to the server. Pass it when the ZIP is saved remotely: the
   * dialog then stays open until the server answers and closes only on success. Leave it out for a local
   * stand-in, which closes the dialog at once.
   */
  pending?: boolean;
  /** Shopper-facing text of a server error, shown in the dialog so it can be read and corrected. */
  error?: string;
};

/** Utility-bar entry point for the delivery ZIP (REQ-NAV-003). Opens the ZIP dialog. */
export function DeliveryZipControl({
  zip,
  onSubmit,
  onClear,
  pending,
  error,
}: DeliveryZipControlProps) {
  const [open, setOpen] = useState(false);
  const tracksPending = pending !== undefined;
  // `waiting`: a request was sent from the dialog; `seenPending`: the answer is now in flight.
  const waiting = useRef(false);
  const seenPending = useRef(false);

  useEffect(() => {
    if (pending) {
      seenPending.current = true;
    } else if (waiting.current && seenPending.current) {
      waiting.current = false;
      seenPending.current = false;
      if (!error) setOpen(false);
    }
  }, [pending, error]);

  function finish() {
    if (tracksPending) {
      waiting.current = true;
      seenPending.current = false;
    } else {
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        // The form's chunk starts downloading on intent, so it is ready when the dialog opens (P7-06).
        onPointerEnter={() => void zipFormPanel.preload()}
        onFocus={() => void zipFormPanel.preload()}
        onPointerDown={() => void zipFormPanel.preload()}
        className="inline-flex min-h-touch shrink-0 items-center gap-2 font-bold underline underline-offset-2 hover:no-underline"
      >
        <TruckIcon className="size-5" />
        <span>
          {zip ? (
            <>
              Delivering to <span className="underline">{zip}</span>
            </>
          ) : (
            'Enter delivery ZIP'
          )}
        </span>
      </button>
      <ZipEntryDialog
        open={open}
        onClose={() => setOpen(false)}
        initialZip={zip}
        serverError={error}
        onSubmit={(next) => {
          onSubmit(next);
          finish();
        }}
        onClear={() => {
          onClear();
          finish();
        }}
      />
    </>
  );
}

/**
 * Shown in place of the control when this deployment cannot keep a ZIP (P3B-11). Plain text, not a button: a
 * control that opens a form which can never save would be worse than saying so. No ZIP, no promise.
 */
export function DeliveryZipUnavailable() {
  return (
    <span className="inline-flex min-h-touch shrink-0 items-center gap-2">
      <TruckIcon className="size-5" />
      {/* One word below 412 px so the utility bar stays one row at 320 and 360 px (BV-015: the full text needs about
          352 px beside the store link, and this project's `sm` is only 360 px). The full text is always the accessible name. */}
      <span className="sr-only min-[412px]:not-sr-only">
        Delivery check unavailable
      </span>
      <span aria-hidden="true" className="min-[412px]:hidden">
        Unavailable
      </span>
    </span>
  );
}
