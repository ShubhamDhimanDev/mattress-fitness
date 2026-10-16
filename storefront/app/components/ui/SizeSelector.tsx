import {useId} from 'react';
import {cn} from '~/components/ui/cn';
import {FieldError} from '~/components/ui/Field';

export type SizeOption = {
  /** Stable id, e.g. the option value from the URL (`?Size=Queen`). */
  id: string;
  label: string;
  /** Dimensions of this size as the catalog states them, e.g. `60" x 80"`. Shown once the size is selected. */
  dimensions?: string;
  available: boolean;
  /** Why it cannot be chosen; defaults to "Sold out". */
  unavailableReason?: string;
};

type SizeSelectorProps = {
  options: readonly SizeOption[];
  /** Selected option id, or null when nothing is selected yet. */
  value: string | null;
  onChange: (id: string) => void;
  /** Form field name; the radios submit with the form. */
  name?: string;
  legend?: string;
  error?: string;
  className?: string;
};

/**
 * Size choice as a radio group drawn as bordered rectangular buttons in three columns. Native radios give
 * the arrow-key behaviour and form support; the selected size is filled with the accent colour and also
 * gets a heavier border, so selection never depends on colour alone. Sold-out sizes are disabled and say why
 * in their label. Whether a size is available is decided by the caller from Shopify data.
 */
export function SizeSelector({
  options,
  value,
  onChange,
  name = 'size',
  legend = 'Size',
  error,
  className,
}: SizeSelectorProps) {
  const baseId = useId();
  const errorId = `${baseId}-error`;
  const selected = options.find((option) => option.id === value);

  return (
    <fieldset
      className={cn('min-w-0', className)}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="text-base font-bold text-fg">
        {legend}
        {selected ? `: ${selected.label}` : null}
      </legend>
      <p aria-live="polite" className="mt-1 mb-3 min-h-5 text-sm text-fg-muted">
        {selected
          ? (selected.dimensions ?? '')
          : 'Select a size to see its dimensions.'}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => {
          const inputId = `${baseId}-${option.id}`;
          return (
            <div key={option.id} className="relative">
              <input
                type="radio"
                id={inputId}
                name={name}
                value={option.id}
                checked={option.id === value}
                disabled={!option.available}
                onChange={() => {
                  // Belt and braces: a disabled radio cannot fire in a browser, but never report a sold-out size.
                  if (option.available) onChange(option.id);
                }}
                className="peer sr-only"
              />
              <label
                htmlFor={inputId}
                className={cn(
                  'flex min-h-touch flex-col items-center justify-center rounded-choice border-2 px-2 py-2 text-center text-sm font-bold motion-safe:transition-colors peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
                  option.available
                    ? 'cursor-pointer border-line-strong bg-surface text-fg hover:border-ink-900 peer-checked:border-ink-900 peer-checked:bg-accent-400 peer-checked:text-ink-900'
                    : 'cursor-not-allowed border-line bg-surface-muted text-fg-muted',
                )}
              >
                <span className={option.available ? undefined : 'line-through'}>
                  {option.label}
                </span>
                {option.available ? null : (
                  <>
                    {/* A real space keeps the accessible name "King Sold out" in every screen reader. */}{' '}
                    <span className="text-xs font-normal">
                      {option.unavailableReason ?? 'Sold out'}
                    </span>
                  </>
                )}
              </label>
            </div>
          );
        })}
      </div>
      <FieldError id={errorId}>{error}</FieldError>
    </fieldset>
  );
}
