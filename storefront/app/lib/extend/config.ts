// SERVER ONLY. Reads Extend credentials from the request-context env (never process.env, ADR-0004).
// Nothing in this module may be imported by code that reaches the browser (T-04).
//
// The access token is held in a closure and is not a property of the config object, so JSON.stringify,
// structured logs and error reports cannot leak it by accident.

export type ExtendOrderSyncMode = 'self' | 'extend-app' | 'off';

/** Extend's documented hosts (EXTEND.md section 2). Loopback is allowed for the local MOCK only. */
const EXTEND_HOSTS: ReadonlySet<string> = new Set([
  'api-demo.helloextend.com',
  'api.helloextend.com',
]);
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
]);

const ORDER_SYNC_MODES: readonly ExtendOrderSyncMode[] = [
  'self',
  'extend-app',
  'off',
];

export type ExtendConfig = {
  /** Origin only, for example "https://api-demo.helloextend.com" or "http://127.0.0.1:4010" (the mock). */
  readonly apiHost: string;
  readonly storeId: string;
  readonly orderSync: ExtendOrderSyncMode;
  /** Documented headers (Accept version, access token). The token is reachable only through this function. */
  readonly requestHeaders: (options: {json: boolean}) => Record<string, string>;
};

export type ExtendDisabledReason =
  | 'flag_off'
  | 'missing_credentials'
  | 'invalid_host'
  | 'invalid_store_id'
  | 'invalid_token'
  | 'invalid_order_sync';

export type ExtendConfigResult =
  | {status: 'enabled'; config: ExtendConfig}
  | {
      status: 'disabled';
      reason: ExtendDisabledReason;
      /** Names of the missing variables, never values. */
      missing: readonly string[];
    };

export type ExtendEnvInput = {readonly [key: string]: unknown};

export type ParseConfigOptions = {
  /**
   * Offers need the flag. Order sync may be kept running after the flag hides the UI so orders that already
   * contain coverage still reach Extend; pass `false` for that caller.
   */
  requireFlag?: boolean;
  /**
   * True when running as a production build. The loopback mock host is then refused: a production environment
   * pointing at http://127.0.0.1 would report orders to nothing and send the token in clear.
   */
  production?: boolean;
};

function readString(env: ExtendEnvInput, key: string): string | null {
  const value = env[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Returns the normalised origin, or null when the host is not an allow-listed Extend host (or the loopback mock). */
export function parseExtendHost(
  raw: string,
  options: {allowLoopback?: boolean} = {},
): string | null {
  const allowLoopback = options.allowLoopback ?? true;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '') return null;
  if (url.search !== '' || url.hash !== '') return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;

  if (EXTEND_HOSTS.has(url.hostname)) {
    return url.protocol === 'https:' && url.port === '' ? url.origin : null;
  }
  if (allowLoopback && LOOPBACK_HOSTS.has(url.hostname)) {
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : null;
  }
  return null;
}

export function parseExtendConfig(
  env: ExtendEnvInput,
  options: ParseConfigOptions = {},
): ExtendConfigResult {
  const requireFlag = options.requireFlag ?? true;
  const disabled = (
    reason: ExtendDisabledReason,
    missing: readonly string[] = [],
  ): ExtendConfigResult => ({status: 'disabled', reason, missing});

  // Exactly 'true': any other value (including "TRUE", "1", "yes") leaves Extend off.
  if (requireFlag && env['PUBLIC_EXTEND_ENABLED'] !== 'true') {
    return disabled('flag_off');
  }

  const host = readString(env, 'EXTEND_API_HOST');
  const storeId = readString(env, 'EXTEND_STORE_ID');
  const token = readString(env, 'EXTEND_ACCESS_TOKEN');
  const missing = [
    host === null ? 'EXTEND_API_HOST' : null,
    storeId === null ? 'EXTEND_STORE_ID' : null,
    token === null ? 'EXTEND_ACCESS_TOKEN' : null,
  ].filter((name): name is string => name !== null);
  if (host === null || storeId === null || token === null) {
    return disabled('missing_credentials', missing);
  }

  const apiHost = parseExtendHost(host, {
    allowLoopback: options.production !== true,
  });
  if (apiHost === null) return disabled('invalid_host');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(storeId)) {
    return disabled('invalid_store_id');
  }
  // Printable ASCII without spaces: blocks header injection through a malformed secret.
  if (!/^[\x21-\x7E]{1,4096}$/.test(token)) return disabled('invalid_token');

  // An unset mode means "self" (ADR-0009); an unrecognised value fails closed rather than guessing,
  // because a wrong guess either double-reports orders or silently drops them.
  const modeRaw = readString(env, 'EXTEND_ORDER_SYNC');
  const orderSync =
    modeRaw === null
      ? 'self'
      : ORDER_SYNC_MODES.find((mode) => mode === modeRaw);
  if (orderSync === undefined) return disabled('invalid_order_sync');

  return {
    status: 'enabled',
    config: {
      apiHost,
      storeId,
      orderSync,
      requestHeaders: ({json}) => ({
        'X-Extend-Access-Token': token,
        Accept: 'application/json;version=2022-02-01',
        ...(json ? {'Content-Type': 'application/json'} : {}),
      }),
    },
  };
}
