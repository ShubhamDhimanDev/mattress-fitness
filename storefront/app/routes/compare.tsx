import {useEffect, useRef, useState} from 'react';
import {
  Link,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
} from 'react-router';
import type {Route} from './+types/compare';
import {CompareTable} from '~/components/compare/CompareTable';
import {ComparePicker} from '~/components/compare/ComparePicker';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {PreviewNotice} from '~/components/pages/PreviewNotice';
import {buttonStyles} from '~/components/ui/Button';
import {cardStyles} from '~/components/ui/Card';
import {cn} from '~/components/ui/cn';
import {Select} from '~/components/ui/Select';
import {isSize} from '~/lib/catalog/attributes';
import {
  buildComparisonTable,
  commonSizes,
  COMPARE_MAX_PRODUCTS,
  similarProducts,
} from '~/lib/compare';
import {lowestAvailablePriceCents} from '~/lib/catalog/pricing';
import {getLocalStorage} from '~/lib/pages/browser-storage';
import {
  comparePath,
  handlesOf,
  loadHandlesFromDevice,
  parseHandlesParam,
  parseSizeParam,
  pickerItems,
  rejectionMessage,
  resolveSelection,
  saveHandlesToDevice,
  withHandle,
  withoutHandle,
  HANDLES_PARAM,
} from '~/lib/pages/compare-view';
import {getCompareCandidates} from '~/lib/pages/data-source';
import {formatCents} from '~/lib/money';

// P6-05: product comparison (REQ-CMP-001). The selection lives in the URL (?handles=a,b&size=Queen), is
// remembered on the device, and is re-validated against the catalog on every request.

export const meta: Route.MetaFunction = () => [
  {title: formatPageTitle('Compare mattresses')},
  {
    name: 'description',
    content:
      'Compare mattresses side by side by rating, price, comfort, type, height and benefits.',
  },
  // A comparison is a personal selection, not a page to index.
  {name: 'robots', content: 'noindex,follow'},
];

export async function loader({request}: Route.LoaderArgs) {
  const url = new URL(request.url);
  const handles = parseHandlesParam(url.searchParams);
  const requestedSize = parseSizeParam(url.searchParams);
  const {source, candidates} = await getCompareCandidates(handles);

  const {selection, notices} = resolveSelection(handles, candidates);
  const sizes = commonSizes(selection);
  // A size only applies when every selected product is sold in it.
  const size =
    requestedSize !== null && sizes.includes(requestedSize)
      ? requestedSize
      : null;

  const similar =
    selection.length > 0 && selection.length < COMPARE_MAX_PRODUCTS
      ? similarProducts(selection[0] ?? candidates[0], candidates, {
          size,
          exclude: handlesOf(selection),
        }).map((product) => {
          const cents = lowestAvailablePriceCents(product);
          return {
            handle: product.handle,
            title: product.title,
            brand: product.brand,
            priceText:
              cents === null ? null : formatCents(cents, {compact: true}),
          };
        })
      : [];

  return {
    source,
    handles: handlesOf(selection),
    size,
    sizes,
    notices,
    table:
      selection.length > 0 ? buildComparisonTable(selection, {size}) : null,
    picker: pickerItems(selection, candidates),
    similar,
    // The catalog for client-side rule checks is just the picker's handles and titles.
    titles: Object.fromEntries(
      candidates.map((product) => [product.handle, product.title]),
    ),
  };
}

export default function ComparePage() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousCount = useRef(data.handles.length);

  const {handles, size} = data;

  useEffect(() => setHydrated(true), []);

  // A bare /compare restores what this device compared last time; a link with handles wins and is remembered.
  const hasHandlesParam = searchParams.has(HANDLES_PARAM);
  useEffect(() => {
    const storage = getLocalStorage();
    if (!storage) return;
    if (handles.length > 0) {
      saveHandlesToDevice(storage, handles);
      return;
    }
    if (!hasHandlesParam) {
      const stored = loadHandlesFromDevice(storage);
      if (stored.length > 0) {
        void navigate(comparePath(stored), {replace: true});
      }
    }
  }, [handles, hasHandlesParam, navigate]);

  // After the selection changes, focus goes to the heading so the shopper hears the new state instead of
  // losing focus when the activated button disappears.
  useEffect(() => {
    if (previousCount.current !== handles.length) {
      previousCount.current = handles.length;
      headingRef.current?.focus();
    }
  }, [handles.length]);

  // While a change is loading, the checkboxes already show the choice that is being applied.
  const pendingLocation =
    navigation.state !== 'idle' && navigation.location?.pathname === '/compare'
      ? navigation.location
      : null;
  const shownHandles = pendingLocation
    ? parseHandlesParam(new URLSearchParams(pendingLocation.search))
    : handles;
  const pickerItemsShown = data.picker.map((item) => ({
    ...item,
    checked: shownHandles.includes(item.handle),
  }));

  const update = (next: readonly string[]) => {
    const storage = getLocalStorage();
    if (storage) saveHandlesToDevice(storage, next);
    void navigate(comparePath(next, next.length > 0 ? size : null), {
      replace: true,
      preventScrollReset: true,
    });
  };

  const onToggle = (handle: string, checked: boolean) => {
    setMessage('');
    if (!checked) {
      update(withoutHandle(shownHandles, handle));
      return;
    }
    // The server re-checks every rule on the next request; this gives the shopper the reason straight away.
    const candidate = data.picker.find((item) => item.handle === handle);
    if (candidate?.blocked) {
      setMessage(
        rejectionMessage(
          candidate.blocked,
          data.titles[handle] ?? 'That product',
        ),
      );
      return;
    }
    update(withHandle(shownHandles, handle));
  };

  const empty = data.table === null;
  const hasDifferences = data.table?.rows.some((row) => row.differs) ?? false;

  return (
    <div className="mx-auto flex max-w-page flex-col gap-8 py-8">
      <header className="flex flex-col gap-3 rounded-panel bg-paper p-6 md:p-10">
        <h1 className="type-display text-hero md:text-heading">
          Compare mattresses
        </h1>
        <p className="max-w-prose text-lead text-fg-muted">
          Pick up to {COMPARE_MAX_PRODUCTS} products to see their rating, price,
          comfort level, type, height and benefits side by side.
        </p>
      </header>

      {data.source === 'fixtures' ? (
        <PreviewNotice subject="mattresses" />
      ) : null}

      <div role="status" aria-live="polite" className="min-h-6">
        {message ? (
          <p className="rounded-card border-2 border-error-fg bg-error-bg p-3 text-sm font-bold text-error-fg">
            {message}
          </p>
        ) : null}
        {data.notices.map((notice) => (
          <p
            key={notice}
            className="rounded-card border-2 border-warning-fg bg-warning-bg p-3 text-sm text-warning-fg"
          >
            {notice}
          </p>
        ))}
      </div>

      <section
        aria-labelledby="compare-selection-heading"
        // min-w-0: a flex child may shrink below its content, so the wide table scrolls inside its own region.
        className="flex min-w-0 flex-col gap-4"
      >
        <h2
          id="compare-selection-heading"
          ref={headingRef}
          tabIndex={-1}
          className="type-display text-3xl"
        >
          Your comparison
        </h2>
        {empty ? (
          <p className="text-base text-fg-muted">
            You have not chosen any products yet. Choose two or more below to
            compare them.
          </p>
        ) : (
          <>
            {data.sizes.length > 0 ? (
              <Select
                label="Show prices for size"
                value={size ?? ''}
                placeholder="Lowest available price"
                options={data.sizes.map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  void navigate(
                    comparePath(handles, isSize(value) ? value : null),
                    {replace: true, preventScrollReset: true},
                  );
                }}
                className="max-w-sm"
              />
            ) : null}
            {data.handles.length === 1 ? (
              <p className="text-base text-fg-muted">
                Add at least one more product to compare.
              </p>
            ) : null}
            {data.table ? (
              <CompareTable
                table={data.table}
                removeHref={(handle) =>
                  comparePath(withoutHandle(handles, handle), size)
                }
                onRemove={(handle) => {
                  const storage = getLocalStorage();
                  if (storage) {
                    saveHandlesToDevice(
                      storage,
                      withoutHandle(handles, handle),
                    );
                  }
                }}
              />
            ) : null}
            {data.handles.length > 1 && !hasDifferences ? (
              <p className="text-sm text-fg-muted">
                These products match on every row shown.
              </p>
            ) : null}
          </>
        )}
      </section>

      {data.similar.length > 0 ? (
        <section
          aria-labelledby="compare-similar-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="compare-similar-heading" className="type-display text-3xl">
            Similar products
          </h2>
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {data.similar.map((product) => (
              <li
                key={product.handle}
                className={cn(
                  cardStyles({padding: 'sm'}),
                  'flex flex-col gap-2',
                )}
              >
                <span className="text-caption font-bold tracking-wide text-fg-muted uppercase">
                  {product.brand}
                </span>
                <span className="text-lg font-extrabold">{product.title}</span>
                {product.priceText ? (
                  <span className="text-sm text-fg-muted">
                    From {product.priceText}
                  </span>
                ) : null}
                <Link
                  to={comparePath(withHandle(handles, product.handle), size)}
                  replace
                  preventScrollReset
                  onClick={() => {
                    const storage = getLocalStorage();
                    if (storage) {
                      saveHandlesToDevice(
                        storage,
                        withHandle(handles, product.handle),
                      );
                    }
                  }}
                  aria-label={`Add ${product.title} to comparison`}
                  className={cn(
                    buttonStyles({variant: 'secondary', size: 'sm'}),
                    'mt-auto',
                  )}
                >
                  Add to comparison
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="compare-picker-heading" className="max-w-4xl">
        <h2 id="compare-picker-heading" className="sr-only">
          Choose products
        </h2>
        <ComparePicker
          items={pickerItemsShown}
          selectedCount={shownHandles.length}
          showSubmit={!hydrated}
          onToggle={onToggle}
        />
      </section>
    </div>
  );
}
