import {useId, type ReactNode} from 'react';
import {cn} from '~/components/ui/cn';
import {AlertIcon} from '~/components/ui/Icons';

/** Ids shared by a form control, its hint and its error so they can be wired with aria-describedby. */
export function useFieldIds(idProp?: string) {
  const generated = useId();
  const id = idProp ?? generated;
  return {id, hintId: `${id}-hint`, errorId: `${id}-error`};
}

/** The value for aria-describedby: only the messages that are actually rendered. */
export function describedBy(
  ids: {hintId: string; errorId: string},
  parts: {hint?: ReactNode; error?: ReactNode},
): string | undefined {
  const used = [
    parts.hint ? ids.hintId : null,
    parts.error ? ids.errorId : null,
  ];
  const joined = used.filter(Boolean).join(' ');
  return joined.length > 0 ? joined : undefined;
}

export function FieldHint({id, children}: {id: string; children: ReactNode}) {
  if (!children) return null;
  return (
    <p id={id} className="text-sm text-fg-muted">
      {children}
    </p>
  );
}

/**
 * The live region is always rendered, empty when there is no error, so a screen reader is already
 * watching it when validation text appears (WCAG 4.1.3). The icon means the error is not colour-only.
 */
export function FieldError({id, children}: {id: string; children?: ReactNode}) {
  return (
    <div id={id} aria-live="polite">
      {children ? (
        <p className="flex items-start gap-1 text-sm font-bold text-error-fg">
          <AlertIcon className="mt-0.5 size-4 shrink-0" />
          <span>{children}</span>
        </p>
      ) : null}
    </div>
  );
}

/** The visible label of a field. The asterisk is decoration: `required` on the control carries the meaning. */
export function FieldLabel({
  htmlFor,
  required = false,
  hidden = false,
  children,
}: {
  htmlFor: string;
  required?: boolean;
  /** Visually hidden but still read by screen readers (a search field next to its button). */
  hidden?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('text-sm font-bold text-fg', hidden && 'sr-only')}
    >
      {children}
      {required ? (
        <span aria-hidden="true" className="text-error-fg">
          {' '}
          *
        </span>
      ) : null}
    </label>
  );
}

/** What `Field` hands to the control it wraps: spread these onto the input, select or custom control. */
export type FieldControlProps = {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  required: boolean | undefined;
};

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Use a fixed id (for a label elsewhere on the page); otherwise one is generated. */
  id?: string;
  hideLabel?: boolean;
  className?: string;
  /** Render prop: put the control here and spread `control` onto it. */
  children: (control: FieldControlProps) => ReactNode;
};

/**
 * Label, control, hint and error for a control that has no primitive of its own (a date picker, a ZIP and button
 * pair, a custom listbox). `Input` and `Select` use the same parts, so the spacing and the error pattern are identical.
 *
 *   <Field label="ZIP code" error={error}>
 *     {(control) => <input {...control} className={CONTROL_CLASSES} />}
 *   </Field>
 */
export function Field({
  label,
  hint,
  error,
  required,
  id,
  hideLabel = false,
  className,
  children,
}: FieldProps) {
  const ids = useFieldIds(id);
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <FieldLabel htmlFor={ids.id} required={required} hidden={hideLabel}>
        {label}
      </FieldLabel>
      {children({
        id: ids.id,
        'aria-describedby': describedBy(ids, {hint, error}),
        'aria-invalid': error ? true : undefined,
        required,
      })}
      <FieldHint id={ids.hintId}>{hint}</FieldHint>
      <FieldError id={ids.errorId}>{error}</FieldError>
    </div>
  );
}
