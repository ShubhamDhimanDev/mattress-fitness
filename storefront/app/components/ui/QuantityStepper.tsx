import {useState, type KeyboardEvent} from 'react';
import {cn} from '~/components/ui/cn';
import {MinusIcon, PlusIcon} from '~/components/ui/Icons';

type QuantityStepperProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  /**
   * Upper bound offered in the UI. It is a convenience only: the real limit (stock, haul-away maximum,
   * Extend quantity linked to its item) is enforced on the server from Shopify data.
   */
  max?: number;
  /** Accessible name of the group and the input, e.g. "Quantity". */
  label?: string;
  /** Names the item in the button labels: "Decrease quantity of Queen mattress". */
  itemName?: string;
  disabled?: boolean;
  /** `sm` is the cart drawer's pill: 44 px buttons in a 1 px border, a smaller number. */
  size?: 'md' | 'sm';
  className?: string;
};

export function clampQuantity(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

// 46 px buttons inside a 2 px bordered group (CR-31); both are above the 44 px touch target. The `sm` pill (cart drawer)
// keeps 44 px buttons, round, inside a 1 px border. There is no class merging, so the two sizes are separate strings.
const STEP_BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center text-fg motion-safe:transition-colors hover:bg-paper active:bg-ink-100 aria-disabled:cursor-not-allowed aria-disabled:text-fg-muted aria-disabled:hover:bg-transparent';
const STEP_BUTTON = `${STEP_BUTTON_BASE} size-11.5 rounded-sm`;
const STEP_BUTTON_SMALL = `${STEP_BUTTON_BASE} size-11 rounded-pill`;

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  label = 'Quantity',
  itemName,
  disabled = false,
  size = 'md',
  className,
}: QuantityStepperProps) {
  const small = size === 'sm';
  // While typing, the field shows the draft text; it is committed (and clamped) on blur or Enter.
  const [draft, setDraft] = useState<string | null>(null);
  const atMin = value <= min;
  const atMax = value >= max;
  const suffix = itemName ? ` of ${itemName}` : '';

  function commit(text: string) {
    setDraft(null);
    if (!/^\d+$/.test(text)) return;
    const next = clampQuantity(Number(text), min, max);
    if (next !== value) onChange(next);
  }

  function step(delta: number) {
    if (disabled) return;
    const next = clampQuantity(value + delta, min, max);
    if (next !== value) onChange(next);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(event.currentTarget.value);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      step(1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      step(-1);
    }
  }

  // aria-disabled (not disabled) at the limits: a disabled button would drop focus the moment the shopper
  // presses it to reach the limit.
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex items-center bg-surface hover:border-ink-600',
        small
          ? 'rounded-pill border border-line-strong'
          : 'rounded-choice border-2 border-line-strong',
        className,
      )}
    >
      <button
        type="button"
        aria-label={`Decrease quantity${suffix}`}
        aria-disabled={disabled || atMin ? true : undefined}
        onClick={() => step(-1)}
        className={small ? STEP_BUTTON_SMALL : STEP_BUTTON}
      >
        <MinusIcon className={small ? 'size-4' : 'size-5'} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        aria-label={`${label}${suffix}`}
        disabled={disabled}
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, ''))}
        onBlur={(event) => {
          if (draft !== null) commit(event.target.value);
        }}
        onKeyDown={onInputKeyDown}
        className={cn(
          'bg-transparent text-center font-extrabold text-fg disabled:text-fg-muted',
          small
            ? 'h-11 w-8 text-sm'
            : 'h-11.5 w-12 border-x-2 border-line text-base',
        )}
      />
      <button
        type="button"
        aria-label={`Increase quantity${suffix}`}
        aria-disabled={disabled || atMax ? true : undefined}
        onClick={() => step(1)}
        className={small ? STEP_BUTTON_SMALL : STEP_BUTTON}
      >
        <PlusIcon className={small ? 'size-4' : 'size-5'} />
      </button>
      <span className="sr-only" role="status">
        {`${label} ${value}`}
      </span>
    </div>
  );
}
