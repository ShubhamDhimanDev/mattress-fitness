// SERVER ONLY. Picks named variables out of the request-context env (ADR-0004: never process.env).
// `context.env` is typed as an interface, which TypeScript will not pass as an index-signature record, and the
// Extend config parser takes a plain record. Picking by name also means nothing else in the env travels with it.

import type {ExtendEnvInput} from '~/lib/extend/config';

/** Every variable the Extend server code reads. Names only; values never appear in code, logs or tests. */
export const EXTEND_ENV_KEYS = [
  'PUBLIC_EXTEND_ENABLED',
  'EXTEND_API_HOST',
  'EXTEND_STORE_ID',
  'EXTEND_ACCESS_TOKEN',
  'EXTEND_ORDER_SYNC',
] as const;

export function pickEnv(
  env: object,
  keys: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    const value: unknown = Reflect.get(env, key);
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}

export function extendEnvOf(env: object): ExtendEnvInput {
  return pickEnv(env, EXTEND_ENV_KEYS);
}

/** A trimmed non-empty string, or null. */
export function readEnvString(env: object, key: string): string | null {
  const value: unknown = Reflect.get(env, key);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
