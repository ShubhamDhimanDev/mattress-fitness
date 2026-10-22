import {useId, useState, type FormEvent} from 'react';
import {Link, useNavigate} from 'react-router';
import {Button} from '~/components/ui/Button';
import {Checkbox} from '~/components/ui/Checkbox';
import {ChevronDownIcon} from '~/components/ui/Icons';
import {Input} from '~/components/ui/Input';
import {
  FILTER_DIMENSIONS,
  countActiveFilters,
  type FilterState,
} from '~/lib/filters';
import {
  FILTER_LABELS,
  centsToDollarsInput,
  hrefForPrice,
  hrefForReset,
  hrefForToggle,
  type FilterGroupView,
} from '~/lib/shopify/listing';

type FilterPanelProps = {
  groups: readonly FilterGroupView[];
  state: FilterState;
  pathname: string;
  /** Parameters the codec must keep, such as the search term. */
  base: URLSearchParams;
};

/**
 * Filters (REQ-COL-002). Every change is a navigation to a URL built by the shared codec, so the URL is
 * the only state: shareable, and the back button undoes a filter. Counts are Shopify's. The price range is
 * two whole-dollar fields with an Apply button, so it works with a keyboard and on a phone.
 */
export function FilterPanel({groups, state, pathname, base}: FilterPanelProps) {
  const navigate = useNavigate();
  const active = countActiveFilters(state);
  const go = (href: string) => {
    void navigate(href, {preventScrollReset: true});
  };

  return (
    <div className="flex flex-col gap-4">
      {active > 0 ? (
        <Link
          to={hrefForReset(pathname, state, base)}
          preventScrollReset
          className="inline-flex min-h-touch items-center text-sm font-bold text-primary-700 underline underline-offset-2"
        >
          Clear all filters ({active})
        </Link>
      ) : null}

      {groups.map((group, position) => (
        <details
          key={group.dimension}
          open={position < 3 || group.options.some((option) => option.selected)}
          className="group border-b border-line pb-2"
        >
          <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between text-lg font-extrabold [&::-webkit-details-marker]:hidden">
            {group.label}
            <ChevronDownIcon className="size-5 text-fg-muted motion-safe:transition-transform group-open:rotate-180" />
          </summary>
          <fieldset className="min-w-0">
            <legend className="sr-only">{group.label}</legend>
            <ul>
              {group.options.map((option) => (
                <li key={option.value}>
                  <Checkbox
                    checked={option.selected}
                    onChange={() =>
                      go(
                        hrefForToggle(
                          pathname,
                          state,
                          group.dimension,
                          option.value,
                          base,
                        ),
                      )
                    }
                    label={
                      <>
                        {option.value}{' '}
                        <span className="text-fg-muted">({option.count})</span>
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
          </fieldset>
        </details>
      ))}

      <PriceRange
        key={`${state.priceMinCents}-${state.priceMaxCents}`}
        state={state}
        onApply={(min, max) =>
          go(hrefForPrice(pathname, state, min, max, base))
        }
      />
    </div>
  );
}

function PriceRange({
  state,
  onApply,
}: {
  state: FilterState;
  onApply: (min: string, max: string) => void;
}) {
  const headingId = useId();
  const [min, setMin] = useState(centsToDollarsInput(state.priceMinCents));
  const [max, setMax] = useState(centsToDollarsInput(state.priceMaxCents));

  function submit(event: FormEvent) {
    event.preventDefault();
    onApply(min, max);
  }

  return (
    <form
      onSubmit={submit}
      aria-labelledby={headingId}
      className="flex flex-col gap-2"
    >
      <h3 id={headingId} className="text-lg font-extrabold">
        Price
      </h3>
      <div className="flex items-end gap-2">
        <Input
          label="Minimum price in dollars"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Min"
          maxLength={6}
          value={min}
          onChange={(event) => setMin(event.target.value.replace(/\D/g, ''))}
        />
        <Input
          label="Maximum price in dollars"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Max"
          maxLength={6}
          value={max}
          onChange={(event) => setMax(event.target.value.replace(/\D/g, ''))}
        />
      </div>
      <Button type="submit" variant="secondary" size="sm">
        Apply price
      </Button>
    </form>
  );
}

/** Currently applied filters as removable chips, so the shopper sees what narrows the list. */
export function ActiveFilters({
  state,
  pathname,
  base,
}: Omit<FilterPanelProps, 'groups'>) {
  const chips = FILTER_DIMENSIONS.flatMap((dimension) =>
    state.selected[dimension].map((value) => ({
      key: `${dimension}:${value}`,
      label: value,
      group: FILTER_LABELS[dimension],
      href: hrefForToggle(pathname, state, dimension, value, base),
    })),
  );
  if (state.priceMinCents !== null || state.priceMaxCents !== null) {
    const min = centsToDollarsInput(state.priceMinCents);
    const max = centsToDollarsInput(state.priceMaxCents);
    chips.push({
      key: 'price',
      label: `$${min || '0'} to ${max ? `$${max}` : 'any'}`,
      group: 'Price',
      href: hrefForPrice(pathname, state, '', '', base),
    });
  }
  if (chips.length === 0) return null;

  return (
    <ul aria-label="Active filters" className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.key}>
          <Link
            to={chip.href}
            preventScrollReset
            aria-label={`Remove filter ${chip.group}: ${chip.label}`}
            className="inline-flex min-h-touch items-center gap-1 rounded-pill bg-primary-50 px-3 text-sm font-bold text-primary-800 hover:bg-primary-100"
          >
            {chip.label}
            <span aria-hidden="true">&times;</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
