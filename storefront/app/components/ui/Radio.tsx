import {forwardRef, type ComponentPropsWithoutRef, type ReactNode} from 'react';
import {cn} from '~/components/ui/cn';
import {CHOICE_INPUT_CLASSES, choiceRowClasses} from '~/components/ui/Checkbox';
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
  /** `card` draws the row as a bordered choice card; see Checkbox. */
  variant?: 'plain' | 'card';
  className?: string;
};

// Group radios in a <fieldset><legend> so the group has a name; arrow keys then move between them natively.
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
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
          type="radio"
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
});
