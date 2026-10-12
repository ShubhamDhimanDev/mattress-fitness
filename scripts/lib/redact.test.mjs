import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REDACTED, createLogger, redactText, redactValue, scrubSecrets } from './redact.mjs';

const TOKEN = 'test-token-not-real-0123456789abcdef';

test('redactText removes exact secrets everywhere they appear', () => {
  const out = redactText(`failed with ${TOKEN} and again ${TOKEN}`, [TOKEN]);
  assert.equal(out.includes(TOKEN), false);
  assert.equal(out, `failed with ${REDACTED} and again ${REDACTED}`);
});

test('redactText ignores empty or non-string secrets instead of blanking the text', () => {
  assert.equal(redactText('hello', ['', undefined]), 'hello');
});

test('redactText catches token-shaped values nobody listed', () => {
  // built from parts so that a repository secret scanner does not mistake the test data for a real token
  const shopifyShaped = ['shp', 'at_', 'abcdef123456'].join('');
  const bearerValue = ['abcdefgh', 'ijklmnop'].join('');
  assert.equal(redactText(`using ${shopifyShaped} now`).includes(shopifyShaped), false);
  assert.equal(redactText(`Authorization: Bearer ${bearerValue}`).includes(bearerValue), false);
  assert.equal(redactText('X-Shopify-Access-Token: whatever-value-here').includes('whatever-value-here'), false);
});

test('redactValue hides sensitive keys and nested secrets, and turns errors into plain objects', () => {
  const out = /** @type {Record<string, any>} */ (
    redactValue({ headers: { 'X-Shopify-Access-Token': TOKEN, accept: 'json' }, note: `token ${TOKEN}`, error: new Error(`boom ${TOKEN}`), list: [TOKEN] }, [TOKEN])
  );
  assert.equal(out.headers['X-Shopify-Access-Token'], REDACTED);
  assert.equal(out.headers.accept, 'json');
  assert.equal(JSON.stringify(out).includes(TOKEN), false);
  assert.equal(out.error.name, 'Error');
});

test('redactValue stops at a depth limit instead of looping on cycles', () => {
  /** @type {Record<string, unknown>} */
  const cyclic = {};
  cyclic.self = cyclic;
  assert.ok(JSON.stringify(redactValue(cyclic)).includes('TRUNCATED'));
});

test('scrubSecrets replaces exact secrets in nested strings, keeps keys and other values, and returns the input when clean', () => {
  const clean = { a: 'fine', list: [1, 'two'] };
  assert.equal(scrubSecrets(clean, [TOKEN]), clean, 'same object when nothing to scrub');
  const dirty = { userErrors: [{ message: `bad ${TOKEN}`, field: ['x'] }], policy: 'keep this key and value', n: 5, nothing: null };
  const out = scrubSecrets(dirty, [TOKEN]);
  assert.equal(JSON.stringify(out).includes(TOKEN), false);
  assert.equal(out.userErrors[0].message, `bad ${REDACTED}`);
  assert.equal(out.policy, 'keep this key and value', 'legitimate keys are not masked');
  assert.equal(out.n, 5);
  assert.equal(dirty.userErrors[0].message.includes(TOKEN), true, 'the input is not mutated');
  assert.equal(scrubSecrets(clean, []), clean);
  assert.equal(scrubSecrets(undefined, [TOKEN]), undefined);
});

test('logger writes one redacted JSON line per call and honours the level', () => {
  /** @type {string[]} */
  const lines = [];
  const logger = createLogger({ write: (line) => lines.push(line), secrets: [TOKEN], level: 'info' });
  logger.debug('hidden');
  logger.info(`hello ${TOKEN}`, { token: TOKEN, detail: `x ${TOKEN}` });
  logger.error('bad', { error: new Error(TOKEN) });
  assert.equal(lines.length, 2);
  assert.equal(lines.join('\n').includes(TOKEN), false);
  assert.equal(JSON.parse(lines[0]).level, 'info');
});
