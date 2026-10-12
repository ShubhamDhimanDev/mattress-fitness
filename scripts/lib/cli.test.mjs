import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXIT_FAILED, EXIT_OK, EXIT_REFUSED, EXIT_USAGE, isMainModule, parseFlags, renderTable } from './cli.mjs';

test('exit codes are distinct so scripts and CI can tell a refusal from a failure', () => {
  assert.equal(new Set([EXIT_OK, EXIT_FAILED, EXIT_USAGE, EXIT_REFUSED]).size, 4);
  assert.equal(EXIT_OK, 0);
});

test('parseFlags is strict: unknown flags and missing values are errors, not silently ignored', () => {
  const options = { live: { type: /** @type {const} */ ('boolean') }, store: { type: /** @type {const} */ ('string') } };
  const good = parseFlags(['--live', '--store', 'a.myshopify.com'], options);
  assert.ok(good.ok && good.values.live === true && good.values.store === 'a.myshopify.com');
  assert.equal(parseFlags(['--lve'], options).ok, false, 'a typo of --live must not be ignored');
  assert.equal(parseFlags(['--store'], options).ok, false);
  assert.equal(parseFlags(['file.csv'], options).ok, false, 'positionals are refused unless allowed');
  const positional = parseFlags(['file.csv', '--live'], options, { allowPositionals: true });
  assert.ok(positional.ok && positional.positionals[0] === 'file.csv');
});

test('renderTable aligns columns and truncates long cells', () => {
  const table = renderTable(['a', 'longer'], [['x', 'y'], ['wide-value', 'z'.repeat(100)]], { maxCellWidth: 10 });
  const lines = table.split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^-+  -+$/);
  assert.ok(lines[3].length <= 10 + 2 + 10);
  assert.ok(lines[3].includes('…'));
});

test('renderTable strips control characters so a hostile value cannot rewrite the terminal', () => {
  const table = renderTable(['v'], [['bad\u001b[31mred\nnext\u0007']]);
  // eslint-disable-next-line no-control-regex
  assert.equal(/[\u0000-\u001f\u007f]/.test(table.replace(/\n/g, '')), false);
});

test('isMainModule is true for the entry file and false for imports', () => {
  const self = fileURLToPath(import.meta.url);
  assert.equal(isMainModule(import.meta.url, self), true);
  assert.equal(isMainModule(pathToFileURL(self).href, 'C:\\somewhere\\else.mjs'), false);
  assert.equal(isMainModule(import.meta.url, ''), false);
});
