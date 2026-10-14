// Cookie signing secrets must be long enough to resist guessing (security review E-L1). A shorter value is
// treated as absent, so the code that signs or verifies fails closed instead of running on a weak key.
// Runtime-neutral and pure, apart from the one-line configuration report below.

export const MIN_COOKIE_SECRET_LENGTH = 32;

/** The secret if it is a string of at least 32 characters, otherwise null. */
export function usableCookieSecret(value: unknown): string | null {
  return typeof value === 'string' && value.length >= MIN_COOKIE_SECRET_LENGTH
    ? value
    : null;
}

// Names already reported by this isolate. Module state on purpose: a missing secret is a deployment mistake
// that repeats on every request, and one line per request would bury the log without adding information.
const reportedSecrets = new Set<string>();

/**
 * Logs, once per isolate and only in production, that a secret is missing or too short. Only the variable's
 * NAME is written, never a value or a length (T-05, security rule on secrets). Without this a missing
 * DELIVERY_COOKIE_SECRET looks like a working feature that quietly saves nothing.
 */
export function reportUnusableSecret(
  name: string,
  production: boolean = import.meta.env.PROD,
): void {
  if (!production || reportedSecrets.has(name)) return;
  reportedSecrets.add(name);
  console.error(
    `[config] ${name} is missing or shorter than ${MIN_COOKIE_SECRET_LENGTH} characters. Set it in the hosting environment.`,
  );
}

/** For tests only: forget what has been reported. */
export function resetReportedSecrets(): void {
  reportedSecrets.clear();
}

/**
 * Why the session secret cannot be used, or null when it can. Production demands the full length; local
 * placeholder env files for the mock stores are shorter and stay allowed in development (E-L1). The messages
 * name the variable and the fix, never the value.
 */
export function sessionSecretProblem(
  value: unknown,
  production: boolean,
): string | null {
  if (typeof value !== 'string' || value === '') {
    return `SESSION_SECRET is not set. Set it to a random value of at least ${MIN_COOKIE_SECRET_LENGTH} characters in the hosting environment.`;
  }
  if (production && usableCookieSecret(value) === null) {
    return `SESSION_SECRET is shorter than ${MIN_COOKIE_SECRET_LENGTH} characters. Production refuses to serve requests with a short signing key; replace it with a longer random value.`;
  }
  return null;
}
