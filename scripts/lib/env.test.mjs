import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENV_ADMIN_TOKEN,
  ENV_ALLOWED_STORES,
  LiveGuardError,
  assertLiveAllowed,
  assertStoreAllowed,
  checkLiveAllowed,
  checkStoreAllowed,
  normalizeShopDomain,
  parseAllowedStores,
  readAdminToken,
} from './env.mjs';

const STORE = 'dev-store.myshopify.com';
const env = (/** @type {string | undefined} */ allowed) => ({ [ENV_ALLOWED_STORES]: allowed });

test('normalizeShopDomain accepts only *.myshopify.com and lower-cases it', () => {
  assert.equal(normalizeShopDomain('Dev-Store.myshopify.com'), STORE);
  assert.equal(normalizeShopDomain('https://dev-store.myshopify.com/'), STORE);
  for (const bad of ['shop.example.com', 'evil.com/dev-store.myshopify.com', 'dev-store.myshopify.com.evil.com', '*.myshopify.com', '', null, undefined, 42, 'http://dev-store.myshopify.com', 'a b.myshopify.com']) {
    assert.equal(normalizeShopDomain(bad), null, String(bad));
  }
});

test('parseAllowedStores splits on commas, spaces and newlines and drops anything invalid', () => {
  assert.deepEqual(parseAllowedStores('a-store.myshopify.com, b-store.myshopify.com\nc-store.myshopify.com'), ['a-store.myshopify.com', 'b-store.myshopify.com', 'c-store.myshopify.com']);
  assert.deepEqual(parseAllowedStores('*.myshopify.com, shop.example.com, ok-store.myshopify.com'), ['ok-store.myshopify.com']);
  assert.deepEqual(parseAllowedStores(undefined), []);
  assert.deepEqual(parseAllowedStores('a-store.myshopify.com,A-STORE.myshopify.com'), ['a-store.myshopify.com']);
});

test('live mode is refused without the --live flag, even for an allowed store', () => {
  for (const live of [undefined, false, 'true', 1]) {
    const result = checkLiveAllowed({ live, store: STORE, env: env(STORE) });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'live_flag_missing');
  }
  assert.throws(() => assertLiveAllowed({ live: false, store: STORE, env: env(STORE) }), (error) => error instanceof LiveGuardError && error.reason === 'live_flag_missing');
});

test('live mode is refused when the store is missing, malformed, not listed, or the list is empty', () => {
  const reasons = [
    [{ live: true, store: undefined, env: env(STORE) }, 'store_missing'],
    [{ live: true, store: 'not-a-shop.example.com', env: env(STORE) }, 'store_invalid'],
    [{ live: true, store: STORE, env: env(undefined) }, 'allow_list_empty'],
    [{ live: true, store: STORE, env: env('') }, 'allow_list_empty'],
    [{ live: true, store: STORE, env: env('*.myshopify.com') }, 'allow_list_empty'],
    [{ live: true, store: STORE, env: env('other-store.myshopify.com') }, 'store_not_allowed'],
    // a prefix of an allowed domain must not match
    [{ live: true, store: 'dev.myshopify.com', env: env('dev-store.myshopify.com') }, 'store_not_allowed'],
  ];
  for (const [args, reason] of reasons) {
    const result = checkLiveAllowed(args);
    assert.equal(result.ok, false, reason);
    assert.equal(result.ok === false && result.reason, reason);
  }
});

test('live mode passes only with --live and an allow-listed store, and returns the normalised domain', () => {
  const result = checkLiveAllowed({ live: true, store: 'HTTPS://Dev-Store.myshopify.com/', env: env(`other.myshopify.com ${STORE}`) });
  assert.deepEqual(result, { ok: true, store: STORE });
  assert.equal(assertLiveAllowed({ live: true, store: STORE, env: env(STORE) }), STORE);
});

test('read-only contact with a store also needs the allow-list (T-14)', () => {
  assert.equal(checkStoreAllowed({ store: STORE, env: env(undefined) }).ok, false);
  assert.equal(checkStoreAllowed({ store: STORE, env: env(STORE) }).ok, true);
  assert.throws(() => assertStoreAllowed({ store: STORE, env: env('x-store.myshopify.com') }), LiveGuardError);
});

test('readAdminToken reports a missing token by name only and never echoes a value', () => {
  const missing = readAdminToken({});
  assert.equal(missing.ok, false);
  assert.ok(missing.ok === false && missing.message.includes(ENV_ADMIN_TOKEN));
  const blank = readAdminToken({ [ENV_ADMIN_TOKEN]: '   ' });
  assert.equal(blank.ok, false);
  assert.deepEqual(readAdminToken({ [ENV_ADMIN_TOKEN]: ' abc ' }), { ok: true, token: 'abc' });
});
