import {Link} from 'react-router';
import {MyStoreControl} from '~/components/stores/MyStoreControl';
import {buttonStyles} from '~/components/ui/Button';
import {MapPinIcon, PhoneIcon} from '~/components/ui/Icons';
import {cn} from '~/components/ui/cn';
import type {StoreCardView} from '~/lib/pages/stores-view';

type StoreCardProps = {
  view: StoreCardView;
  /** The store key the my-store form posts (see my-store.ts). */
  storeKey: string;
  isMine: boolean;
  /** Heading level for the store name: cards sit under an h2 on list pages. */
  headingLevel?: 2 | 3;
};

const STATUS_STYLE = {
  open: 'bg-success-bg text-success-fg',
  closed: 'bg-surface-muted text-fg',
  unknown: 'bg-surface-muted text-fg-muted',
} as const;

export function StatusLine({status}: {status: StoreCardView['status']}) {
  return (
    <p
      className={cn(
        'inline-flex w-fit items-center gap-2 rounded-choice px-2 py-1 text-sm font-bold',
        STATUS_STYLE[status.kind],
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-pill',
          status.kind === 'open' ? 'bg-success-solid' : 'bg-ink-400',
        )}
      />
      {status.text}
    </p>
  );
}

/** A store in a list: name, address, tap-to-call, today's hours, status, directions and my-store (REQ-LOC-001). */
export function StoreCard({
  view,
  storeKey,
  isMine,
  headingLevel = 3,
}: StoreCardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article
      aria-label={view.name}
      className="flex h-full flex-col gap-3 rounded-card border-2 border-line bg-surface p-4"
    >
      <Heading className="text-xl font-bold">
        <Link to={view.path} className="underline-offset-2 hover:underline">
          {view.name}
        </Link>
      </Heading>
      {isMine ? (
        <p className="w-fit rounded-choice bg-primary-50 px-2 py-1 text-sm font-bold text-primary-800">
          My store
        </p>
      ) : null}
      <address className="flex items-start gap-2 not-italic">
        <MapPinIcon className="mt-0.5 size-5 text-fg-muted" />
        <span>
          {view.addressLines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </span>
      </address>
      {view.phone ? (
        <a
          href={view.phone.href}
          className="inline-flex min-h-touch w-fit items-center gap-2 font-bold text-primary-700 underline underline-offset-2"
        >
          <PhoneIcon className="size-5" />
          <span>
            <span className="sr-only">Call </span>
            {view.phone.display}
          </span>
        </a>
      ) : null}
      <StatusLine status={view.status} />
      <p className="text-sm text-fg-muted">{view.todayText}</p>
      {view.pickupEnabled ? (
        <p className="text-sm text-fg-muted">In-store pickup available</p>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2 pt-2">
        <a
          href={view.directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonStyles({variant: 'secondary', size: 'sm'})}
        >
          Directions
          <span className="sr-only"> to {view.name} (opens in a new tab)</span>
        </a>
        <MyStoreControl
          storeKey={storeKey}
          storeName={view.name}
          isMine={isMine}
          compact
        />
      </div>
    </article>
  );
}
