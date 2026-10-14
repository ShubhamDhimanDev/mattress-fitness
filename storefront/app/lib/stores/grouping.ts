// State > city > store index, stable slugs and URL builders for the store
// locator (REQ-LOC-001). The routes are
//   /stores
//   /stores/:state            (for example /stores/new-york)
//   /stores/:state/:city      (for example /stores/new-york/buffalo)
//   /stores/:state/:city/:store

import {toSlug} from '~/lib/catalog/attributes';
import type {Store, UsStateCode} from '~/lib/stores/types';
import {US_STATES} from '~/lib/stores/types';

export const STORES_ROOT_PATH = '/stores';
const MAX_SLUG_LENGTH = 80;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type CityGroup = {
  readonly name: string;
  readonly slug: string;
  readonly stores: readonly Store[];
};

export type StateGroup = {
  readonly code: UsStateCode;
  readonly name: string;
  readonly slug: string;
  readonly storeCount: number;
  readonly cities: readonly CityGroup[];
};

export type StoreIndex = {
  readonly states: readonly StateGroup[];
  readonly storeCount: number;
};

export function isValidSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_SLUG_LENGTH &&
    SLUG_PATTERN.test(value)
  );
}

function limitedSlug(text: string): string {
  return toSlug(text).slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
}

export function stateSlug(code: UsStateCode): string {
  return limitedSlug(US_STATES[code]);
}

export function citySlug(city: string): string {
  return limitedSlug(city) || 'city';
}

/** Code-unit comparison: the same order in every runtime and locale. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- Paths ---

export function storesIndexPath(): string {
  return STORES_ROOT_PATH;
}

export function statePath(state: UsStateCode): string {
  return `${STORES_ROOT_PATH}/${encodeURIComponent(stateSlug(state))}`;
}

export function cityPath(state: UsStateCode, city: string): string {
  return `${statePath(state)}/${encodeURIComponent(citySlug(city))}`;
}

/** Uses `store.slug`, which buildStoreIndex makes unique within the city. */
export function storePath(
  store: Pick<Store, 'state' | 'city' | 'slug'>,
): string {
  return `${cityPath(store.state, store.city)}/${encodeURIComponent(store.slug)}`;
}

// --- The index ---

/**
 * Resolves each store's slug so it is unique within its city: the admin slug
 * (or the name when none) is used as given, and a clash gets -2, -3 ... in
 * order of store ID, so the outcome does not depend on the order stores arrive
 * in. Clashes should be fixed in admin; the suffix only keeps every URL working.
 */
function withUniqueSlugs(stores: readonly Store[]): readonly Store[] {
  const sorted = [...stores].sort((a, b) => compareText(a.id, b.id));
  const used = new Map<string, Set<string>>();
  const resolved = new Map<string, Store>();
  for (const store of sorted) {
    const scope = `${store.state}/${citySlug(store.city)}`;
    const taken = used.get(scope) ?? new Set<string>();
    used.set(scope, taken);
    const base = limitedSlug(store.slug) || limitedSlug(store.name) || 'store';
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) {
      const suffix = `-${n}`;
      slug = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
    }
    taken.add(slug);
    resolved.set(store.id, {...store, slug});
  }
  return stores.map((store) => resolved.get(store.id) ?? store);
}

function groupCities(stores: readonly Store[]): readonly CityGroup[] {
  const bySlug = new Map<string, Store[]>();
  for (const store of stores) {
    const slug = citySlug(store.city);
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), store]);
  }
  return [...bySlug.entries()]
    .map(([slug, group]): CityGroup => {
      const sorted = [...group].sort(
        (a, b) => compareText(a.name, b.name) || compareText(a.id, b.id),
      );
      // Spellings of one city ("St. Louis", "St Louis") share a group; show the first by ID.
      const named = [...group].sort((a, b) => compareText(a.id, b.id))[0];
      return {name: named?.city ?? slug, slug, stores: sorted};
    })
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.slug, b.slug));
}

/**
 * Builds the locator index. Stores with a repeated ID are kept once (the first).
 * Output order is alphabetical at every level and does not depend on input order.
 */
export function buildStoreIndex(stores: readonly Store[]): StoreIndex {
  const seen = new Set<string>();
  const unique = stores.filter((store) => {
    if (seen.has(store.id)) return false;
    seen.add(store.id);
    return true;
  });
  const slugged = withUniqueSlugs(unique);

  const byState = new Map<UsStateCode, Store[]>();
  for (const store of slugged) {
    byState.set(store.state, [...(byState.get(store.state) ?? []), store]);
  }
  const states = [...byState.entries()]
    .map(([code, group]): StateGroup => ({
      code,
      name: US_STATES[code],
      slug: stateSlug(code),
      storeCount: group.length,
      cities: groupCities(group),
    }))
    .sort((a, b) => compareText(a.name, b.name));
  return {states, storeCount: slugged.length};
}

// --- Lookups for route params (validated before use) ---

export function findState(index: StoreIndex, slug: unknown): StateGroup | null {
  if (!isValidSlug(slug)) return null;
  return index.states.find((state) => state.slug === slug) ?? null;
}

export function findCity(
  index: StoreIndex,
  stateParam: unknown,
  cityParam: unknown,
): {readonly state: StateGroup; readonly city: CityGroup} | null {
  const state = findState(index, stateParam);
  if (!state || !isValidSlug(cityParam)) return null;
  const city = state.cities.find((candidate) => candidate.slug === cityParam);
  return city ? {state, city} : null;
}

export function findStore(
  index: StoreIndex,
  stateParam: unknown,
  cityParam: unknown,
  storeParam: unknown,
): {
  readonly state: StateGroup;
  readonly city: CityGroup;
  readonly store: Store;
} | null {
  const found = findCity(index, stateParam, cityParam);
  if (!found || !isValidSlug(storeParam)) return null;
  const store = found.city.stores.find(
    (candidate) => candidate.slug === storeParam,
  );
  return store ? {...found, store} : null;
}

/** Every store in index order (state, city, name), for the locator list and the sitemap. */
export function allStores(index: StoreIndex): readonly Store[] {
  return index.states.flatMap((state) =>
    state.cities.flatMap((city) => city.stores),
  );
}

/** Stores a shopper can pick up from (REQ-LOC-002). */
export function pickupStores(index: StoreIndex): readonly Store[] {
  return allStores(index).filter((store) => store.pickupEnabled);
}
