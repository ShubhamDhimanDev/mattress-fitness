import {useState} from 'react';
import {TruckIcon} from '~/components/ui/Icons';
import {ZipEntryDialog} from '~/components/layout/ZipEntryDialog';

type DeliveryZipControlProps = {
  /** The shopper's saved delivery ZIP, or null. */
  zip: string | null;
  onSubmit: (zip: string) => void;
  onClear: () => void;
};

/** Utility-bar entry point for the delivery ZIP (REQ-NAV-003). Opens the ZIP dialog. */
export function DeliveryZipControl({
  zip,
  onSubmit,
  onClear,
}: DeliveryZipControlProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-touch items-center gap-2 font-bold hover:underline"
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
        onSubmit={(next) => {
          onSubmit(next);
          setOpen(false);
        }}
        onClear={() => {
          onClear();
          setOpen(false);
        }}
      />
    </>
  );
}
