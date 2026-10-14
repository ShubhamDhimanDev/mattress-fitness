import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsHtml, escapeHtml, escapeMarkdownCell, looksLikeFormula, neutralizeFormula, sanitizeCell, stripHtml } from './sanitize.mjs';

test('formula starters are detected: = + - @ tab and carriage return', () => {
  for (const value of ['=1+1', '+15555550100', '-2+3', '@SUM(A1)', '\t=1', '\r=1', '=HYPERLINK("http://x","y")']) {
    assert.equal(looksLikeFormula(value), true, JSON.stringify(value));
  }
  for (const value of ['', 'Plush', '1299.00', 'a=b', 'Queen - Size', ' =x']) {
    assert.equal(looksLikeFormula(value), false, JSON.stringify(value));
  }
});

test('neutralizeFormula prefixes a quote so spreadsheets show text, and leaves safe text alone', () => {
  assert.equal(neutralizeFormula('=1+1'), "'=1+1");
  assert.equal(neutralizeFormula('Plush'), 'Plush');
});

test('sanitizeCell rejects formulas with the offending character in the message', () => {
  for (const [value, character] of [['=cmd|calc', '='], ['+1', '+'], ['-1', '-'], ['@x', '@']]) {
    const result = sanitizeCell(value);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.code === 'formula' && result.message.includes(`"${character}"`), value);
  }
});

test('a leading space does not hide a formula, because cells are trimmed first', () => {
  assert.equal(sanitizeCell('  =1+1').ok, false);
});

test('checkFormula can be switched off for numeric columns that have their own parser', () => {
  const result = sanitizeCell('-5', { checkFormula: false });
  assert.deepEqual(result, { ok: true, value: '-5', changed: false });
});

test('HTML tags, comments, doctype and processing instructions are rejected', () => {
  for (const value of ['<b>bold</b>', 'x <script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<!-- hi -->', '<!DOCTYPE html>', '<?xml version="1.0"?>', 'a </div>', '<a href="javascript:alert(1)">x</a>', '<svg/onload=alert(1)>']) {
    const result = sanitizeCell(value);
    assert.equal(result.ok, false, value);
    assert.ok(!result.ok && result.code === 'html', value);
  }
});

test('text that merely contains angle brackets in a comparison is accepted', () => {
  for (const value of ['Firmness < 5 and > 2', '5 < 6', 'a > b', '3 <4']) {
    assert.equal(containsHtml(value), false, value);
  }
  assert.equal(sanitizeCell('Firmness < 5 and > 2').ok, true);
});

test('control characters and, when not allowed, line breaks are rejected', () => {
  assert.ok(!sanitizeCell('bad\u0001text').ok);
  assert.ok(!sanitizeCell('null\u0000byte').ok);
  assert.ok(!sanitizeCell('two\nlines').ok);
  assert.equal(sanitizeCell('two\nlines', { allowNewlines: true }).ok, true);
});

test('length is counted in characters, not UTF-16 units', () => {
  assert.equal(sanitizeCell('😀'.repeat(5), { maxLength: 5 }).ok, true);
  const result = sanitizeCell('😀'.repeat(6), { maxLength: 5 });
  assert.ok(!result.ok && result.code === 'too_long');
});

test('line endings are normalised and the value is trimmed and NFC-normalised', () => {
  const result = sanitizeCell('  line1\r\nline2  ', { allowNewlines: true });
  assert.deepEqual(result, { ok: true, value: 'line1\nline2', changed: true });
  assert.equal(sanitizeCell('é').ok && sanitizeCell('é').value, 'é');
});

test('stripHtml removes tags for callers that must continue; escapeHtml encodes the five characters', () => {
  assert.equal(stripHtml('a <b>b</b> <!-- c --> d'), 'a b  d');
  assert.equal(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
});

test('escapeMarkdownCell stops a value from breaking a report table or adding links and HTML', () => {
  const out = escapeMarkdownCell('a | b\n[link](http://x) <img src=x> `code` **bold**');
  assert.equal(out.includes('\n'), false);
  assert.equal(/(^|[^\\])\|/.test(out), false, out);
  assert.equal(/(^|[^\\])[<>[\]()]/.test(out), false, out);
});
