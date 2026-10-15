import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PORT, LHCI_VERSION, lighthouseCommand, lighthouseUrls, main } from './lighthouse-command.mjs';

// P7-06 (NFR-002): `npm run perf:lighthouse` prints the Lighthouse CI command and runs nothing.

/** @param {string[]} argv */
function run(argv) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const code = main(argv, { out: (text) => out.push(text), err: (text) => err.push(text) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('prints a pinned npx command that uses the committed config and every template URL', () => {
  const { code, out } = run(['--product', 'queen-mattress']);
  assert.equal(code, 0);
  assert.ok(out.startsWith(`npx -y @lhci/cli@${LHCI_VERSION} autorun --config=lighthouserc.json`));
  for (const url of lighthouseUrls({ port: DEFAULT_PORT, collection: 'all', product: 'queen-mattress' })) {
    assert.ok(out.includes(`--collect.url=${url}`), url);
  }
  assert.ok(out.includes('/products/queen-mattress'));
  assert.ok(!out.trimEnd().endsWith('\\'), 'the last line has no continuation');
});

test('takes the port and the collection from flags', () => {
  const { code, out } = run(['--product', 'p-1', '--collection', 'mattresses', '--port', '5100']);
  assert.equal(code, 0);
  assert.ok(out.includes('http://localhost:5100/collections/mattresses'));
});

test('refuses anything that is not a handle or a port, so the printed command cannot be altered', () => {
  for (const argv of [[], ['--product', 'a b'], ['--product', 'x;rm -rf /'], ['--product', '$(whoami)'], ['--product', 'ok', '--collection', '`x`'], ['--product', 'ok', '--port', '80'], ['--product', 'ok', '--port', 'abc'], ['--product', 'ok', '--port', '70000'], ['--bogus']]) {
    const { code, out, err } = run(argv);
    assert.equal(code, 2, JSON.stringify(argv));
    assert.equal(out, '');
    assert.match(err, /Usage|must be/);
  }
});

test('lighthouseCommand is pure text', () => {
  assert.match(lighthouseCommand({ port: 4900, collection: 'all', product: 'x' }), /autorun --config=lighthouserc\.json/);
});
