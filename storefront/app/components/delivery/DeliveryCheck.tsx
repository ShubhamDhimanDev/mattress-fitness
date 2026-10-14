import {useEffect, useId, useRef, useState, type FormEvent} from 'react';
import {useDeliveryZip} from '~/components/delivery/useDeliveryZip';
import {Button} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {TruckIcon} from '~/components/ui/Icons';
import {Skeleton} from '~/components/ui/Skeleton';
import {Input} from '~/components/ui/Input';
import {parseZip} from '~/lib/delivery/zip';
import type {DeliveryView} from '~/lib/delivery/status';
import {
  DELIVERY_ERROR_TEXT,
  type DeliveryResponse,
} from '~/lib/delivery-runtime/response';

type DeliveryCheckProps = {
  /** Heading text; the block is a labelled region, so it is announced by name. */
  title?: string;
  /** An answer the server already has (the /delivery page); otherwise it is fetched after load. */
  initial?: DeliveryResponse;
  /** The product page and cart say nothing when no delivery zone is configured; the /delivery page does. */
  showWhenUnavailable?: boolean;
  /** Re-run the page's loaders after a change, for surfaces whose server data depends on the ZIP (the cart). */
  refreshPageAfterChange?: boolean;
  className?: string;
};

/**
 * "Check delivery" for a ZIP code (P3B-11, P5B-03, REQ-NAV-003, REQ-DEL-002), used on the product page and
 * the cart. The form posts to /delivery, so it works without JavaScript; with it, the answer replaces the
 * form in place. The wording below is placeholder text until the client approves it (Q-008): the only
 * client-approved sentence shown is the promise text from the delivery zone, and it is shown only for a ZIP
 * inside the zone. No dates and no fees are ever stated here.
 */
export function DeliveryCheck({
  title = 'Delivery',
  initial,
  showWhenUnavailable = false,
  refreshPageAfterChange = false,
  className,
}: DeliveryCheckProps) {
  const {response, pending, save, clear} = useDeliveryZip(initial, {
    refreshPageAfterChange,
  });
  const headingId = useId();
  const [editing, setEditing] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const wasPending = useRef(false);

  const delivery: DeliveryView | null = response?.delivery ?? null;
  const serverError = response?.error
    ? DELIVERY_ERROR_TEXT[response.error]
    : undefined;

  // When a save finishes cleanly the form closes; keyboard focus moves to the answer so it is not lost
  // with the button that was just pressed.
  useEffect(() => {
    if (wasPending.current && !pending && !response?.error) {
      setEditing(false);
      statusRef.current?.focus();
    }
    wasPending.current = pending;
  }, [pending, response]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (delivery?.status === 'unavailable' && !showWhenUnavailable) return null;

  // Before the first answer (fetched after load so the page itself carries no ZIP) hold the space the form
  // takes, so nothing below jumps (NFR-002). Without scripts the link below is the way in.
  if (delivery === null) {
    return (
      <section
        aria-labelledby={headingId}
        aria-busy="true"
        className={cn(
          'flex min-h-60 flex-col gap-3 rounded-card border border-line p-4',
          className,
        )}
      >
        <h2
          id={headingId}
          className="flex items-center gap-2 text-base font-bold"
        >
          <TruckIcon className="size-5" />
          {title}
        </h2>
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-40" />
        <noscript>
          <a href="/delivery" className="font-bold underline">
            Check delivery to your ZIP code
          </a>
        </noscript>
      </section>
    );
  }

  const showForm = delivery === null || delivery.status === 'no-zip' || editing;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entered = new FormData(event.currentTarget).get('zip');
    // The same validator the server uses; the server still validates (this only saves a round trip).
    const parsed = parseZip(entered);
    if (!parsed.ok) {
      setLocalError(DELIVERY_ERROR_TEXT['invalid-zip']);
      inputRef.current?.focus();
      return;
    }
    setLocalError(undefined);
    void save(parsed.zip);
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex flex-col gap-3 rounded-card border border-line p-4',
        showForm && 'min-h-60',
        className,
      )}
    >
      <h2
        id={headingId}
        className="flex items-center gap-2 text-base font-bold"
      >
        <TruckIcon className="size-5" />
        {title}
      </h2>

      {/* Always rendered so a screen reader is already watching when the answer replaces the form. */}
      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="flex flex-col gap-1 text-sm outline-none"
      >
        <DeliveryAnswer delivery={delivery} />
      </div>

      {showForm ? (
        <form
          method="post"
          action="/delivery"
          noValidate
          onSubmit={handleSubmit}
          className="flex flex-col gap-2"
        >
          <input type="hidden" name="intent" value="save" />
          <Input
            ref={inputRef}
            label="ZIP code"
            name="zip"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={10}
            defaultValue={
              editing && delivery && 'zip' in delivery ? delivery.zip : ''
            }
            error={localError ?? serverError}
            hint="5 digits, for example 12345."
            onChange={() => {
              if (localError) setLocalError(undefined);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="secondary"
              loading={pending}
              loadingLabel="Checking"
            >
              Check delivery
            </Button>
            {editing ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setLocalError(undefined);
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
          >
            Change ZIP code
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={pending}
            loadingLabel="Clearing"
            onClick={() => void clear()}
          >
            Clear
          </Button>
        </div>
      )}
    </section>
  );
}

function DeliveryAnswer({delivery}: {delivery: DeliveryView | null}) {
  if (delivery === null || delivery.status === 'no-zip') {
    return <p>Enter your ZIP code to see delivery options for your area.</p>;
  }
  switch (delivery.status) {
    case 'unavailable':
      return <p>Delivery information is not available right now.</p>;
    case 'in-zone':
      return (
        <>
          <p className="font-bold">
            In-home delivery is available to {delivery.zip}.
          </p>
          {delivery.promise ? <p>{delivery.promise}</p> : null}
        </>
      );
    case 'outside-zone':
      return <p>In-home delivery is not available to {delivery.zip}.</p>;
    default: {
      const unreachable: never = delivery;
      return unreachable;
    }
  }
}
