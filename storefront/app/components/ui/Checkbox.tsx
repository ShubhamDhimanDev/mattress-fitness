import {forwardRef, type ComponentPropsWithoutRef, type ReactNode} from 'react';
import {cn} from '~/components/ui/cn';
import {
  FieldError,
  FieldHint,
  describedBy,
  useFieldIds,
} from '~/components/ui/Field';

type ChoiceProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'type' | 'size' | 'className' | 'children'
> & {
  label: ReactNode;
  hint?: string;
  error?: string;
  /**
   * `plain` is a bare row. `card` draws the row as a bordered choice card (a delivery method, "Compare" on a product
   * card): the border and tint turn red when checked, and the native control still shows the check, so the state is
   * never colour alone.
   */
  variant?: 'plain' | 'card';
  className?: string;
};

export type CheckboxProps = ChoiceProps;

/** Shared by Checkbox and Radio so the two rows look and behave the same. */
export function choiceRowClasses(variant: 'plain' | 'card'): string {
  return cn(
    'flex min-h-touch cursor-pointer items-center gap-3 text-base text-fg has-[:disabled]:cursor-not-allowed has-[:disabled]:text-fg-muted',
    variant === 'card' &&
      'rounded-choice border-2 border-line-strong bg-surface px-4 py-3 motion-safe:transition-colors hover:border-ink-600 has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50 has-[:disabled]:border-line has-[:disabled]:bg-surface-muted has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
  );
}

export const CHOICE_INPUT_CLASSES =
  'size-6 shrink-0 cursor-[inherit] accent-primary-500';

// The native input is kept (keyboard, forms, autofill, screen readers) and recoloured with accent-color.
// The whole label row is the 44 px target.
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    {label, hint, error, variant = 'plain', className, id, ...rest},
    ref,
  ) {
    const ids = useFieldIds(id);
    return (
      <div className={cn('flex flex-col', className)}>
        <label htmlFor={ids.id} className={choiceRowClasses(variant)}>
          <input
            {...rest}
            ref={ref}
            id={ids.id}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(ids, {hint, error})}
            className={cn(
              CHOICE_INPUT_CLASSES,
              variant === 'card' && 'focus-visible:outline-none',
            )}
          />
          <span>{label}</span>
        </label>
        <FieldHint id={ids.hintId}>{hint}</FieldHint>
        <FieldError id={ids.errorId}>{error}</FieldError>
      </div>
    );
  },
);
