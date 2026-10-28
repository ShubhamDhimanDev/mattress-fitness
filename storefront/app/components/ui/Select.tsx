import {forwardRef, type ComponentPropsWithoutRef} from 'react';
import {cn} from '~/components/ui/cn';
import {
  FieldError,
  FieldHint,
  FieldLabel,
  describedBy,
  useFieldIds,
} from '~/components/ui/Field';
import {CONTROL_CLASSES} from '~/components/ui/Input';
import {ChevronDownIcon} from '~/components/ui/Icons';

export type SelectOption = {value: string; label: string; disabled?: boolean};

export type SelectProps = Omit<
  ComponentPropsWithoutRef<'select'>,
  'size' | 'className' | 'children'
> & {
  label: string;
  options: readonly SelectOption[];
  /** Text of the empty first option, e.g. "Choose a size". Omit when a value is always selected. */
  placeholder?: string;
  hint?: string;
  error?: string;
  className?: string;
};

// A native <select> keeps the platform picker (best on phones) and its keyboard behaviour for free.
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      label,
      options,
      placeholder,
      hint,
      error,
      className,
      id,
      required,
      ...rest
    },
    ref,
  ) {
    const ids = useFieldIds(id);

    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <FieldLabel htmlFor={ids.id} required={required}>
          {label}
        </FieldLabel>
        <div className="relative">
          <select
            {...rest}
            ref={ref}
            id={ids.id}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(ids, {hint, error})}
            className={cn(CONTROL_CLASSES, 'appearance-none pr-12')}
          >
            {placeholder ? <option value="">{placeholder}</option> : null}
            {options.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-fg-muted" />
        </div>
        <FieldHint id={ids.hintId}>{hint}</FieldHint>
        <FieldError id={ids.errorId}>{error}</FieldError>
      </div>
    );
  },
);
