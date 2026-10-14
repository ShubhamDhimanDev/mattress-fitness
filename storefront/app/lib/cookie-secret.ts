// Cookie signing secrets must be long enough to resist guessing (security review E-L1). A shorter value is
// treated as absent, so the code that signs or verifies fails closed instead of running on a weak key.
// Runtime-neutral and pure.

export const MIN_COOKIE_SECRET_LENGTH = 32;

/** The secret if it is a string of at least 32 characters, otherwise null. */
export function usableCookieSecret(value: unknown): string | null {
  return typeof value === 'string' && value.length >= MIN_COOKIE_SECRET_LENGTH
    ? value
    : null;
}
