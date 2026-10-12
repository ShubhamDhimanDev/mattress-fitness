import {useRef, useState, type FormEvent, type RefObject} from 'react';
import {Button} from '~/components/ui/Button';
import {Dialog} from '~/components/ui/Dialog';
import {Input} from '~/components/ui/Input';

// TODO(P3B-11): replace with the shared validator in ~/lib/delivery/zip once the ZIP cookie and the
// server-side read land. Until then the dialog only checks the shape (5 digits), not that the ZIP exists.
const ZIP_PATTERN = /^\d{5}$/;

export function isValidZip5(value: string): boolean {
  return ZIP_PATTERN.test(value.trim());
}

export const ZIP_ERROR_MESSAGE = 'Enter a 5-digit US ZIP code.';

type ZipEntryDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The saved ZIP, if any. */
  initialZip?: string | null;
  /** Called with a ZIP that passed the shape check. The caller stores it (cookie, P3B-11). */
  onSubmit: (zip: string) => void;
  onClear: () => void;
};

/** Delivery ZIP entry (REQ-NAV-003). Presentational: it validates the shape and reports; it stores nothing. */
export function ZipEntryDialog({
  open,
  onClose,
  initialZip,
  onSubmit,
  onClear,
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
      <ZipForm
        inputRef={inputRef}
        initialZip={initialZip ?? ''}
        onSubmit={onSubmit}
        onClear={onClear}
      />
    </Dialog>
  );
}

// Mounted only while the dialog is open, so every opening starts with a clean error state.
function ZipForm({
  inputRef,
  initialZip,
  onSubmit,
  onClear,
}: {
  inputRef: RefObject<HTMLInputElement>;
  initialZip: string;
  onSubmit: (zip: string) => void;
  onClear: () => void;
}) {
  const [value, setValue] = useState(initialZip);
  const [error, setError] = useState<string | undefined>(undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const zip = value.trim();
    if (!isValidZip5(zip)) {
      setError(ZIP_ERROR_MESSAGE);
      inputRef.current?.focus();
      return;
    }
    setError(undefined);
    onSubmit(zip);
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        ref={inputRef}
        label="ZIP code"
        name="zip"
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={5}
        value={value}
        error={error}
        hint="For example, 5 digits like 12345."
        onChange={(event) => {
          setValue(event.target.value.replace(/\D/g, ''));
          if (error) setError(undefined);
        }}
      />
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" variant="pill" fullWidth>
          Save ZIP code
        </Button>
        {initialZip ? (
          <Button
            type="button"
            variant="secondary"
            shape="pill"
            fullWidth
            onClick={onClear}
          >
            Clear ZIP code
          </Button>
        ) : null}
      </div>
    </form>
  );
}
