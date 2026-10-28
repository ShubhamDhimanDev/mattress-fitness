import {forwardRef, type ComponentPropsWithoutRef} from 'react';
import {cn} from '~/components/ui/cn';
import {
  FieldError,
  FieldHint,
  FieldLabel,
  describedBy,
  useFieldIds,
} from '~/components/ui/Field';

export type InputProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'size' | 'className'
> & {
  label: string;
  hint?: string;
  error?: string;
  /** Visually hide the label (still read by screen readers), e.g. for a search field next to a button. */
  hideLabel?: boolean;
  className?: string;
};

/**
 * The look of every text-like control: 52 px high (`h-13`; `min-h-touch` stays as the 44 px floor), 2 px control
 * border (`ink-400`: 3.36:1 on white, 3.07:1 on paper), 12 px radius. An invalid control gets the error border on top
 * of the icon and text the error message carries.
 */
export const CONTROL_CLASSES =
  'h-13 min-h-touch w-full rounded-choice border-2 border-line-strong bg-surface px-4 text-base text-fg hover:border-ink-600 motion-safe:transition-colors disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-surface-muted disabled:text-fg-muted aria-invalid:border-error-solid';

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {label, hint, error, hideLabel = false, className, id, required, ...rest},
  ref,
) {
  const ids = useFieldIds(id);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <FieldLabel htmlFor={ids.id} required={required} hidden={hideLabel}>
        {label}
      </FieldLabel>
      <input
        {...rest}
        ref={ref}
        id={ids.id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, {hint, error})}
        className={CONTROL_CLASSES}
      />
      <FieldHint id={ids.hintId}>{hint}</FieldHint>
      <FieldError id={ids.errorId}>{error}</FieldError>
    </div>
  );
});
