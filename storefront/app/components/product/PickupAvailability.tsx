import {useId} from 'react';
import {Link, useRouteLoaderData} from 'react-router';
import {usePickupAvailability} from '~/components/product/usePickupAvailability';
import {MapPinIcon} from '~/components/ui/Icons';
import {Skeleton} from '~/components/ui/Skeleton';
import {STORE_LOCATOR_PATH} from '~/lib/navigation';
import {myStoreFromRootData} from '~/lib/pages/my-store-summary';
import {tryInStorePath, type PickupAnswer} from '~/lib/stores/pickup';

const LINK =
  'inline-flex min-h-touch items-center font-bold text-primary-700 underline underline-offset-2 hover:no-underline';

/**
 * Store pickup for the selected size and "my store" (P3B-10, REQ-PDP-003, REQ-PDP-004). Four answers: ready for pickup,
 * not available at your store, pickup not offered there, or "choose a store" with a link to the locator. Choosing a
 * different size asks again from the variant already on the page; changing the store (a navigation that refreshes the
 * root loader) does the same. Stock is Shopify's, read on the server; the page shows no count and does no arithmetic. A
 * failed read hides the answer, never shows a wrong one. "Try in store" goes to the store's own page, or the locator.
 */
export function PickupAvailability({
  variantId,
  productHandle,
}: {
  variantId: string;
  productHandle: string;
}) {
  const headingId = useId();
  const myStore = myStoreFromRootData(useRouteLoaderData('root'));
  const state = usePickupAvailability(variantId, myStore?.key ?? null);

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-28 flex-col gap-2 rounded-card border border-line p-4"
    >
      <h2
        id={headingId}
        className="flex items-center gap-2 text-base font-bold"
      >
        <MapPinIcon className="size-5" />
        Store pickup
      </h2>

      {/* Mounted before it has text, so a change of size or store is announced (WCAG 4.1.3). */}
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col gap-1 text-sm"
      >
        {state.status === 'loading' ? (
          <>
            <span className="sr-only">Checking pickup at your store.</span>
            <Skeleton className="h-5 w-3/4" />
          </>
        ) : null}
        {state.status === 'answer' ? <Answer answer={state.answer} /> : null}
      </div>

      <div className="flex flex-wrap gap-x-6">
        {myStore ? (
          <Link to={STORE_LOCATOR_PATH} className={LINK}>
            Change store
          </Link>
        ) : null}
        <Link
          to={tryInStorePath(myStore?.path ?? null, productHandle)}
          className={LINK}
        >
          Try in store
        </Link>
      </div>
    </section>
  );
}

function Answer({answer}: {answer: PickupAnswer}) {
  switch (answer.status) {
    case 'choose_store':
      return (
        <>
          <p>Choose your store to see if this size is ready for pickup.</p>
          <Link to={STORE_LOCATOR_PATH} className={LINK}>
            Choose a store
          </Link>
        </>
      );
    case 'ready':
      return (
        <>
          <p className="font-bold">Ready for pickup at {answer.storeName}.</p>
          {answer.pickUpTime ? <p>{answer.pickUpTime}</p> : null}
        </>
      );
    case 'unavailable':
      return (
        <p>
          Not available for pickup at {answer.storeName}. Choose another store
          or have it delivered.
        </p>
      );
    case 'not_offered':
      return <p>In-store pickup is not offered at {answer.storeName}.</p>;
    default: {
      const unreachable: never = answer;
      return unreachable;
    }
  }
}
