import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, stringifyCsv } from './csv.mjs';

/** @param {string} text */
function fields(text) {
  const result = parseCsv(text);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.ok ? result.records.map((record) => record.fields) : [];
}

test('parses plain records with LF, CRLF and lone CR line ends', () => {
  const expected = [['a', 'b'], ['1', '2']];
  assert.deepEqual(fields('a,b\n1,2\n'), expected);
  assert.deepEqual(fields('a,b\r\n1,2\r\n'), expected);
  assert.deepEqual(fields('a,b\r1,2\r'), expected);
});

test('a missing final newline still yields the last record', () => {
  assert.deepEqual(fields('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('strips a UTF-8 byte order mark so the first header is clean', () => {
  assert.deepEqual(fields('﻿model,brand\nA,B\n')[0], ['model', 'brand']);
});

test('quoted fields keep commas, doubled quotes and embedded newlines (LF and CRLF)', () => {
  assert.deepEqual(fields('a,b\n"x, y","she said ""hi"""\n'), [['a', 'b'], ['x, y', 'she said "hi"']]);
  assert.deepEqual(fields('a\n"line1\nline2"\n'), [['a'], ['line1\nline2']]);
  assert.deepEqual(fields('a\r\n"line1\r\nline2"\r\n'), [['a'], ['line1\r\nline2']]);
});

test('empty fields are kept, including trailing ones', () => {
  assert.deepEqual(fields('a,b,c\n1,,\n,,\n'), [['a', 'b', 'c'], ['1', '', ''], ['', '', '']]);
});

test('blank lines are skipped and do not shift row numbers of later records', () => {
  const result = parseCsv('a,b\n\n1,2\n');
  assert.ok(result.ok);
  assert.deepEqual(result.records.map((record) => record.row), [1, 3]);
});

test('row numbers follow physical records, so a multi-line cell advances them by one record only', () => {
  const result = parseCsv('a\n"x\ny"\nz\n');
  assert.ok(result.ok);
  assert.deepEqual(result.records.map((record) => record.row), [1, 2, 3]);
});

test('a bare quote inside an unquoted field is kept literally', () => {
  assert.deepEqual(fields('a\n5" tall\n'), [['a'], ['5" tall']]);
});

test('rejects an unterminated quoted field', () => {
  const result = parseCsv('a,b\n"oops,1\n');
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error.message, /never closed/);
});

test('rejects text after a closing quote', () => {
  const result = parseCsv('a\n"x"y\n');
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error.message, /after a closing quote/);
});

test('an empty input yields no records', () => {
  assert.deepEqual(fields(''), []);
});

test('whitespace around a quoted field is not trimmed by the parser', () => {
  assert.deepEqual(fields('a\n"  padded  "\n'), [['a'], ['  padded  ']]);
});

test('stringify quotes only when needed and uses CRLF by default', () => {
  assert.equal(stringifyCsv([['a', 'b'], ['x,y', 'plain']]), 'a,b\r\n"x,y",plain\r\n');
  assert.equal(stringifyCsv([['say "hi"']]), '"say ""hi"""\r\n');
  assert.equal(stringifyCsv([['two\nlines']], { eol: '\n' }), '"two\nlines"\n');
  assert.equal(stringifyCsv([['a']], { bom: true }).charCodeAt(0), 0xfeff);
  assert.equal(stringifyCsv([[null, undefined, 0]]), ',,0\r\n');
});

test('round trip: parse(stringify(rows)) returns the same cells, including awkward ones', () => {
  const rows = [
    ['model', 'description'],
    ['A, B', 'He said "no"\nand left'],
    ['  padded', ''],
    ['unicode ✓ é', 'tab\there'],
  ];
  for (const eol of ['\r\n', '\n']) {
    assert.deepEqual(fields(stringifyCsv(rows, { eol })), rows);
  }
});
