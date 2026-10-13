import {useEffect, useState} from 'react';
import {Link} from 'react-router';
import {cn} from '~/components/ui/cn';
import {COMPARE_MAX_PRODUCTS} from '~/lib/compare';
import {getLocalStorage} from '~/lib/pages/browser-storage';
import {
  comparePath,
  loadHandlesFromDevice,
  planCompareAdd,
  saveHandlesToDevice,
} from '~/lib/pages/compare-view';

type CompareToggleProps = {
  handle: string;
  title: string;
  /** Extra classes for the wrapper; cards use it to lift the control above the card's cover link. */
  className?: string;
};

type Outcome =
  | {readonly kind: 'idle'}
  | {
      readonly kind: 'in-comparison';
      readonly handles: readonly string[];
      /** True only right after the shopper pressed the control, so a page load does not announce anything. */
      readonly justAdded: boolean;
    }
  | {readonly kind: 'full'; readonly handles: readonly string[]};

const LINK_CLASS =
  'inline-flex min-h-touch items-center text-sm font-bold text-primary-700 underline underline-offset-2';

/**
 * "Add to compare" (REQ-CMP-001) on cards and the product page. It is a link to
 * `/compare?handles=<this product>`, so it works without JavaScript. With JavaScript it adds the product to
 * the selection remembered on this device (the same storage and rules as the compare page) without leaving
 * the page, and then offers a link to the comparison. The same-category rule is applied by /compare.
 */
export function CompareToggle({handle, title, className}: CompareToggleProps) {
  const [outcome, setOutcome] = useState<Outcome>({kind: 'idle'});

  // Reflect what this device already holds. Only after mount: the server cannot see local storage.
  useEffect(() => {
    const storage = getLocalStorage();
    if (!storage) return;
    const stored = loadHandlesFromDevice(storage);
    if (stored.includes(handle)) {
      setOutcome({kind: 'in-comparison', handles: stored, justAdded: false});
    }
  }, [handle]);

  function add() {
    const storage = getLocalStorage();
    const stored = storage ? loadHandlesFromDevice(storage) : [];
    const plan = planCompareAdd(stored, handle);
    switch (plan.status) {
      case 'rejected':
        setOutcome({kind: 'full', handles: stored});
        return;
      case 'invalid':
        return;
      case 'added':
        if (storage) saveHandlesToDevice(storage, plan.handles);
        setOutcome({
          kind: 'in-comparison',
          handles: plan.handles,
          justAdded: true,
        });
        return;
      case 'present':
        setOutcome({
          kind: 'in-comparison',
          handles: plan.handles,
          justAdded: false,
        });
        return;
      default: {
        const unreachable: never = plan;
        return unreachable;
      }
    }
  }

  const message =
    outcome.kind === 'in-comparison'
      ? outcome.justAdded
        ? `Added to comparison (${outcome.handles.length} of ${COMPARE_MAX_PRODUCTS}).`
        : ''
      : outcome.kind === 'full'
        ? `You can compare up to ${COMPARE_MAX_PRODUCTS} products. Remove one on the comparison page to add another.`
        : '';

  return (
    <div className={cn('flex flex-col items-start', className)}>
      {outcome.kind === 'idle' ? (
        <Link
          to={comparePath([handle])}
          onClick={(event) => {
            event.preventDefault();
            add();
          }}
          aria-label={`Add ${title} to comparison`}
          className={LINK_CLASS}
        >
          Add to compare
        </Link>
      ) : (
        <Link to={comparePath(outcome.handles)} className={LINK_CLASS}>
          View comparison ({outcome.handles.length})
        </Link>
      )}
      {/* Always rendered so the announcement is read when its text changes. */}
      <p role="status" className="text-xs text-fg-muted">
        {message}
      </p>
    </div>
  );
}
