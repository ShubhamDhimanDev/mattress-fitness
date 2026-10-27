// The hero's finder card (CR-31): size, feel and brand choices that end in a collection URL the filter codec already
// understands. Parameter names and values are NOT written here: each one is read back from `serializeFilterParams`, so the
// finder can only ever produce what `parseFilterParams` accepts, and an unknown value never gets an option.

import {COMFORT_LEVELS, type Size} from '~/lib/catalog/attributes';
import {
  emptyFilterState,
  serializeFilterParams,
  toggleSelection,
  type FilterDimension,
} from '~/lib/filters';

export type FinderOption = {
  /** What the shopper reads. */
  readonly label: string;
  /** What the form sends: the codec's own spelling (`queen`, `ultra-plush`, a brand name). */
  readonly value: string;
};

export type FinderField = {
  /** The URL parameter the collection page reads. */
  readonly name: string;
  readonly options: readonly FinderOption[];
};

export type HomeFinderData = {
  /** The page the form goes to: a collection, or the collections index. */
  readonly action: string;
  readonly size: FinderField;
  readonly comfort: FinderField | null;
  readonly brand: FinderField | null;
};

/** The codec's parameter name and value for one filter value, or null when the codec would drop it. */
function codecEntry(
  dimension: FilterDimension,
  label: string,
): {readonly name: string; readonly value: string} | null {
  const params = serializeFilterParams(
    toggleSelection(emptyFilterState(), {
      kind: 'value',
      dimension,
      value: label,
    }),
  );
  const first = [...params.entries()][0];
  return first ? {name: first[0], value: first[1]} : null;
}

function fieldFor(
  dimension: FilterDimension,
  labels: readonly string[],
): FinderField | null {
  const options: FinderOption[] = [];
  let name: string | null = null;
  for (const label of labels) {
    const entry = codecEntry(dimension, label);
    if (entry === null) continue;
    name = entry.name;
    options.push({label, value: entry.value});
  }
  return name === null ? null : {name, options};
}

/**
 * The finder for the hero. `collectionHandle` is the collection the size and brand tiles already link to. Returns null
 * when there is no size to offer: the card is then left out rather than shown half empty.
 */
export function buildFinder(
  collectionHandle: string | null,
  sizes: readonly Size[],
  brands: readonly string[],
): HomeFinderData | null {
  const size = fieldFor('size', sizes);
  if (size === null) return null;
  return {
    action: collectionHandle
      ? `/collections/${collectionHandle}`
      : '/collections',
    size,
    comfort: fieldFor('comfortLevel', COMFORT_LEVELS),
    brand: fieldFor('brand', brands),
  };
}

/**
 * The URL for a submitted finder form: only the known parameter names and only non-empty values, so "any feel" does not
 * leave `comfort=` in the address. Pure, so the same rule is tested without a browser.
 */
export function finderHref(
  finder: HomeFinderData,
  entries: Iterable<readonly [string, string]>,
): string {
  const allowed = new Map<string, ReadonlySet<string>>(
    [finder.size, finder.comfort, finder.brand].flatMap((field) =>
      field
        ? [[field.name, new Set(field.options.map((o) => o.value))] as const]
        : [],
    ),
  );
  const params = new URLSearchParams();
  for (const [name, value] of entries) {
    if (allowed.get(name)?.has(value) && !params.getAll(name).includes(value)) {
      params.append(name, value);
    }
  }
  const query = params.toString();
  return query === '' ? finder.action : `${finder.action}?${query}`;
}
