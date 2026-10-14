import {useRef, useState, type FormEvent, type RefObject} from 'react';
import {Button} from '~/components/ui/Button';
import {Dialog} from '~/components/ui/Dialog';
import {Input} from '~/components/ui/Input';
import {parseZip} from '~/lib/delivery/zip';
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

/** Delivery ZIP entry (REQ-NAV-003). Presentational: it validates the shape and reports; it stores nothing. */
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
      <ZipForm
        inputRef={inputRef}
        initialZip={initialZip ?? ''}
        onSubmit={onSubmit}
        onClear={onClear}
        serverError={serverError}
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
  serverError,
}: {
  inputRef: RefObject<HTMLInputElement>;
  initialZip: string;
  onSubmit: (zip: string) => void;
  onClear: () => void;
  serverError?: string;
}) {
  const [value, setValue] = useState(initialZip);
  const [error, setError] = useState<string | undefined>(undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseZip(value);
    if (!parsed.ok) {
      setError(ZIP_ERROR_MESSAGE);
      inputRef.current?.focus();
      return;
    }
    setError(undefined);
    onSubmit(parsed.zip);
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
        error={error ?? serverError}
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
