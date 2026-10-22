import {forwardRef, type ComponentPropsWithoutRef, type ReactNode} from 'react';
import {cn} from '~/components/ui/cn';
import {
  FieldError,
  FieldHint,
  describedBy,
  useFieldIds,
} from '~/components/ui/Field';

export type RadioProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'type' | 'size' | 'className' | 'children'
> & {
  label: ReactNode;
  hint?: string;
  error?: string;
  className?: string;
};

// Group radios in a <fieldset><legend> so the group has a name; arrow keys then move between them natively.
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  {label, hint, error, className, id, ...rest},
  ref,
) {
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
          type="radio"
          aria-describedby={describedBy(ids, {hint, error})}
          className="size-6 shrink-0 cursor-[inherit] accent-primary-500"
        />
        <span>{label}</span>
      </label>
      <FieldHint id={ids.hintId}>{hint}</FieldHint>
      <FieldError id={ids.errorId}>{error}</FieldError>
    </div>
  );
});
