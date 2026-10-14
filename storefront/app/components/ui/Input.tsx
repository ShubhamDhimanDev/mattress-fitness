import {forwardRef, type ComponentPropsWithoutRef} from 'react';
import {cn} from '~/components/ui/cn';
import {
  FieldError,
  FieldHint,
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

export const CONTROL_CLASSES =
  'min-h-touch w-full rounded-choice border-2 border-line-strong bg-surface px-3 text-base text-fg disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-muted aria-invalid:border-error-solid';

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {label, hint, error, hideLabel = false, className, id, required, ...rest},
  ref,
) {
  const ids = useFieldIds(id);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        htmlFor={ids.id}
        className={cn('text-sm font-bold text-fg', hideLabel && 'sr-only')}
      >
        {label}
        {required ? (
          <span aria-hidden="true" className="text-error-fg">
            {' '}
            *
          </span>
        ) : null}
      </label>
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
