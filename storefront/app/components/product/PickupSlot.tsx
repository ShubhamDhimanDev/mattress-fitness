import {lazy, Suspense, useEffect, useState} from 'react';

// The pickup section is below the buy button and needs the browser (it asks for stock after load), so it stays out
// of the product route's first chunk and is fetched once the page is interactive (P3B-10). The space it will fill is
// held from the first paint so nothing below it moves (NFR-002).
const PickupAvailability = lazy(() =>
  import('~/components/product/PickupAvailability').then((module) => ({
    default: module.PickupAvailability,
  })),
);

const PLACEHOLDER = (
  <div
    aria-hidden="true"
    className="min-h-28 rounded-card border border-line"
  />
);

export function PickupSlot({
  variantId,
  productHandle,
}: {
  variantId: string;
  productHandle: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return PLACEHOLDER;
  return (
    <Suspense fallback={PLACEHOLDER}>
      <PickupAvailability variantId={variantId} productHandle={productHandle} />
    </Suspense>
  );
}
