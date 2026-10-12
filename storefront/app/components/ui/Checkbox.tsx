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
  className?: string;
};

export type CheckboxProps = ChoiceProps;

// The native input is kept (keyboard, forms, autofill, screen readers) and recoloured with accent-color.
// The whole label row is the 44 px target.
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({label, hint, error, className, id, ...rest}, ref) {
    const ids = useFieldIds(id);
    return (
      <div className={cn('flex flex-col', className)}>
        <label
          htmlFor={ids.id}
          className="flex min-h-touch cursor-pointer items-center gap-3 text-base text-fg has-[:disabled]:cursor-not-allowed has-[:disabled]:text-fg-muted"
        >
          <input
            {...rest}
            ref={ref}
            id={ids.id}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(ids, {hint, error})}
            className="size-6 shrink-0 cursor-[inherit] accent-primary-700"
          />
          <span>{label}</span>
        </label>
        <FieldHint id={ids.hintId}>{hint}</FieldHint>
        <FieldError id={ids.errorId}>{error}</FieldError>
      </div>
    );
  },
);
