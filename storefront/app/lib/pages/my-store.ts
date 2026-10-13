// "My store" selection (REQ-LOC-003): a first-party cookie holding which store
// the shopper chose. The value is not personal data; it names a store from our
// own list. Every read validates it against that list, so a tampered cookie
// selects nothing instead of anything.
//
// The value is `<state>.<city>.<store>` (the three URL slugs, joined by dots,
// which slugs never contain) because a store slug alone is only unique within
// its city (grouping.ts).

import {findStore, isValidSlug, type StoreIndex} from '~/lib/stores/grouping';
import {citySlug, stateSlug} from '~/lib/stores/grouping';
import type {Store} from '~/lib/stores/types';

export const MY_STORE_COOKIE = 'my_store';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export function myStoreKey(
  store: Pick<Store, 'state' | 'city' | 'slug'>,
): string {
  return [stateSlug(store.state), citySlug(store.city), store.slug].join('.');
}

/** The store a key names, or null for anything that is not in the index. */
export function resolveMyStore(index: StoreIndex, key: unknown): Store | null {
  if (typeof key !== 'string' || key.length > 240) return null;
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  const [state, city, slug] = parts;
  if (![state, city, slug].every(isValidSlug)) return null;
  return findStore(index, state, city, slug)?.store ?? null;
}

/** Reads one cookie from a Cookie header; tolerant of any junk around it. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function readMyStore(
  index: StoreIndex,
  cookieHeader: string | null,
): Store | null {
  return resolveMyStore(index, readCookie(cookieHeader, MY_STORE_COOKIE));
}

type CookieOptions = {readonly secure: boolean};

/** Set-Cookie value. HttpOnly because only the server reads it (pickup, header). */
export function setMyStoreCookie(
  store: Pick<Store, 'state' | 'city' | 'slug'>,
  options: CookieOptions,
): string {
  return [
    `${MY_STORE_COOKIE}=${encodeURIComponent(myStoreKey(store))}`,
    'Path=/',
    `Max-Age=${ONE_YEAR_SECONDS}`,
    'SameSite=Lax',
    'HttpOnly',
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearMyStoreCookie(options: CookieOptions): string {
  return [
    `${MY_STORE_COOKIE}=`,
    'Path=/',
    'Max-Age=0',
    'SameSite=Lax',
    'HttpOnly',
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}

export type MyStoreIntent =
  | {readonly type: 'set'; readonly store: Store}
  | {readonly type: 'clear'; readonly returnTo: Store | null}
  | {readonly type: 'invalid'};

/**
 * Reads the form posted by the "Set as my store" and "Clear" buttons. `store`
 * is a store key; an unknown key on "set" is rejected, on "clear" it only
 * loses the return location.
 */
export function parseMyStoreForm(
  index: StoreIndex,
  form: FormData,
): MyStoreIntent {
  const intent = form.get('intent');
  const store = resolveMyStore(index, form.get('store'));
  if (intent === 'set') {
    return store ? {type: 'set', store} : {type: 'invalid'};
  }
  if (intent === 'clear') return {type: 'clear', returnTo: store};
  return {type: 'invalid'};
}
