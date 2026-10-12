import {useId, type ReactNode} from 'react';
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
          <AlertIcon className="mt-0.5 size-4" />
          <span>{children}</span>
        </p>
      ) : null}
    </div>
  );
}
