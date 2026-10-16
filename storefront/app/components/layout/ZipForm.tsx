import {useEffect, useState, type FormEvent, type RefObject} from 'react';
import {Button} from '~/components/ui/Button';
import {Input} from '~/components/ui/Input';
import {parseZip} from '~/lib/delivery/zip';
import {DELIVERY_ERROR_TEXT} from '~/lib/delivery-runtime/response';

export type ZipFormProps = {
  inputRef: RefObject<HTMLInputElement>;
  initialZip: string;
  onSubmit: (zip: string) => void;
  onClear: () => void;
  serverError?: string;
};

/**
 * The form inside the ZIP dialog. It lives in its own module so that it (with the input and the ZIP parser) is
 * downloaded when the dialog is first wanted, not with every page (P7-06). Mounted only while the dialog is
 * open, so every opening starts with a clean error state.
 */
export function ZipForm({
  inputRef,
  initialZip,
  onSubmit,
  onClear,
  serverError,
}: ZipFormProps) {
  const [value, setValue] = useState(initialZip);
  const [error, setError] = useState<string | undefined>(undefined);

  // If the download finished after the dialog opened, the dialog has already put focus on its close button
  // (the input did not exist yet). Move it to the field, as the dialog would have done (WCAG 2.4.3). Focus
  // anywhere outside the dialog is left alone.
  useEffect(() => {
    const input = inputRef.current;
    const active = document.activeElement;
    const dialog = input?.closest('[role="dialog"]');
    if (input && dialog && active && dialog.contains(active)) input.focus();
  }, [inputRef]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseZip(value);
    if (!parsed.ok) {
      setError(DELIVERY_ERROR_TEXT['invalid-zip']);
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
