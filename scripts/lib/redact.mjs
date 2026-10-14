// Redaction and structured logging for the Shopify tooling (T-04, T-05).
// Rule: a token must never reach stdout, stderr, a report or a manifest. Callers pass the
// secrets they hold; pattern-based redaction is a second net for anything token-shaped.

export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY = /^(x-shopify-access-token|authorization|access[_-]?token|token|secret|password|api[_-]?key|signature|policy|credential|x-goog-.*|x-amz-.*)$/i;

// Shopify token prefixes (shpat_, shpua_, shpca_, shppa_, shpss_) and bearer values.
const TOKEN_PATTERNS = [
  /\bshp(?:at|ua|ca|pa|ss)_[A-Za-z0-9]{6,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /(x-shopify-access-token["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
];

const MAX_DEPTH = 6;

/**
 * @param {string} text
 * @param {readonly string[]} [secrets] exact values to remove wherever they appear
 * @returns {string}
 */
export function redactText(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) out = out.split(secret).join(REDACTED);
  }
  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, (match, prefix) => (typeof prefix === 'string' ? `${prefix}${REDACTED}` : REDACTED));
  }
  return out;
}

/**
 * Deep-copies a value for logging with secrets removed. Errors become plain objects.
 * @param {unknown} value
 * @param {readonly string[]} [secrets]
 * @param {number} [depth]
 * @returns {unknown}
 */
export function redactValue(value, secrets = [], depth = 0) {
  if (typeof value === 'string') return redactText(value, secrets);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message, secrets) };
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets, depth + 1));
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(inner, secrets, depth + 1);
  }
  return out;
}

/**
 * Replaces exact secrets inside any string of a response body, leaving every key and other value
 * untouched (key-based masking would blank legitimate Shopify fields). Returns the same object when
 * no secret occurs, so the common case costs one serialisation.
 * @template T
 * @param {T} value
 * @param {readonly string[]} secrets
 * @returns {T}
 */
export function scrubSecrets(value, secrets) {
  const active = secrets.filter((secret) => typeof secret === 'string' && secret.length > 0);
  if (active.length === 0) return value;
  const text = JSON.stringify(value);
  if (text === undefined || !active.some((secret) => text.includes(secret))) return value;
  /** @param {unknown} node @returns {unknown} */
  const walk = (node) => {
    if (typeof node === 'string') return active.reduce((current, secret) => current.split(secret).join(REDACTED), node);
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, inner]) => [key, walk(inner)]));
    return node;
  };
  return /** @type {T} */ (walk(value));
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * One JSON object per line, redacted. The sink is injected so tests can capture output.
 * @param {{ write?: (line: string) => void, secrets?: readonly string[], level?: keyof typeof LEVELS }} [options]
 */
export function createLogger({ write = (line) => process.stderr.write(`${line}\n`), secrets = [], level = 'info' } = {}) {
  const threshold = LEVELS[level];
  /** @param {keyof typeof LEVELS} name */
  const emit = (name) => (/** @type {string} */ msg, /** @type {Record<string, unknown>} */ fields = {}) => {
    if (LEVELS[name] < threshold) return;
    write(JSON.stringify({ level: name, msg: redactText(msg, secrets), ...(/** @type {object} */ (redactValue(fields, secrets))) }));
  };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}

/** @typedef {ReturnType<typeof createLogger>} Logger */

/** A logger that discards everything; handy default for library code and tests. */
export const silentLogger = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });
