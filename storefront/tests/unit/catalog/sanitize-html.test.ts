import {describe, expect, it} from 'vitest';
import {safeUrl, sanitizeHtml} from '~/lib/shopify/sanitize-html';

// T-07 / M-3: Shopify HTML reaches the DOM only through this sanitiser.
describe('sanitizeHtml (T-07)', () => {
  it('keeps ordinary formatting', () => {
    expect(
      sanitizeHtml(
        '<p>Hello <strong>sleepers</strong></p><ul><li>One</li></ul>',
      ),
    ).toBe('<p>Hello <strong>sleepers</strong></p><ul><li>One</li></ul>');
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
  });

  it.each([
    ['script element', '<p>a</p><script>alert(1)</script><p>b</p>'],
    [
      'script with attributes',
      '<script src="https://evil.test/x.js"></script>',
    ],
    ['style element', '<style>body{display:none}</style>x'],
    ['iframe', '<iframe src="https://evil.test"></iframe>x'],
    ['object and embed', '<object data="x"></object><embed src="x">y'],
    ['svg script', '<svg><script>alert(1)</script></svg>'],
    ['unterminated script', '<p>a</p><script>alert(1)'],
    ['mixed case', '<ScRiPt>alert(1)</sCrIpT>'],
  ])('removes %s and its content', (_name, html) => {
    const clean = sanitizeHtml(html);
    expect(clean.toLowerCase()).not.toContain('<script');
    expect(clean.toLowerCase()).not.toContain('<iframe');
    expect(clean.toLowerCase()).not.toContain('<style');
    expect(clean).not.toContain('alert(1)');
  });

  it('does not let a split tag rebuild a script element', () => {
    const clean = sanitizeHtml('<scr<script>ipt>alert(1)</scr</script>ipt>');
    // Leftover characters are inert escaped text, never a tag.
    expect(clean).not.toMatch(/<\/?[a-z]/i);
  });

  it('removes event handler and style attributes', () => {
    const clean = sanitizeHtml(
      '<p onclick="x()" style="color:red" onmouseover=x()>hi</p><img src="https://cdn.example/a.png" onerror="x()" alt="a">',
    );
    expect(clean).toBe(
      '<p>hi</p><img src="https://cdn.example/a.png" alt="a">',
    );
    expect(clean).not.toMatch(/on\w+=/i);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'jav&#x61;script:alert(1)',
    'jav&#97;script:alert(1)',
    'javascript&colon;alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:x',
    '//evil.test/x',
    '/\\evil.test',
  ])('drops the href %j', (href) => {
    const clean = sanitizeHtml(`<a href="${href}">link</a>`);
    expect(clean).toBe('<a>link</a>');
  });

  it('keeps safe links and adds rel', () => {
    expect(sanitizeHtml('<a href="https://example.com/a?b=1&c=2">x</a>')).toBe(
      '<a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">x</a>',
    );
    expect(sanitizeHtml('<a href="/pages/about" target="_blank">x</a>')).toBe(
      '<a href="/pages/about" rel="noopener noreferrer">x</a>',
    );
    expect(sanitizeHtml('<a href="mailto:help@example.com">x</a>')).toContain(
      'mailto:help@example.com',
    );
  });

  it('only allows https images', () => {
    expect(sanitizeHtml('<img src="http://cdn.example/a.png">')).toBe('<img>');
    expect(sanitizeHtml('<img src="javascript:x">')).toBe('<img>');
    expect(
      sanitizeHtml(
        '<img src="https://cdn.example/a.png" width="10" height="x">',
      ),
    ).toBe('<img src="https://cdn.example/a.png" width="10">');
  });

  it('keeps the text of unknown tags but not the tags', () => {
    expect(sanitizeHtml('<custom-tag>safe text</custom-tag>')).toBe(
      'safe text',
    );
    expect(sanitizeHtml('<form action="/x"><button>go</button></form>')).toBe(
      'go',
    );
  });

  it('demotes h1 so the page keeps one h1', () => {
    expect(sanitizeHtml('<h1>Title</h1>')).toBe('<h2>Title</h2>');
  });

  it('escapes stray angle brackets and ampersands in text', () => {
    expect(sanitizeHtml('1 < 2 & 3 > 2')).toBe('1 &lt; 2 &amp; 3 &gt; 2');
    expect(sanitizeHtml('<p>Tom &amp; Jerry</p>')).toBe(
      '<p>Tom &amp; Jerry</p>',
    );
    expect(sanitizeHtml('<a href="x>click')).not.toContain('<a ');
  });

  it('drops comments and doctypes', () => {
    expect(sanitizeHtml('a<!-- <script>x</script> -->b<!DOCTYPE html>')).toBe(
      'ab',
    );
  });

  it('balances tags', () => {
    expect(sanitizeHtml('<p><strong>a</p>b</strong>')).toBe(
      '<p><strong>a</strong></p>b',
    );
    expect(sanitizeHtml('</div>text')).toBe('text');
  });

  it('bounds nesting depth and input size', () => {
    const deep = '<div>'.repeat(500) + 'x';
    expect(
      (sanitizeHtml(deep).match(/<div>/g) ?? []).length,
    ).toBeLessThanOrEqual(40);
    const huge = 'a'.repeat(1_000_000);
    expect(sanitizeHtml(huge).length).toBeLessThanOrEqual(300_000);
  });

  it('is idempotent: sanitising twice changes nothing', () => {
    const once = sanitizeHtml(
      '<p onclick="x">a &amp; b <a href="javascript:x">c</a><script>y</script></p>',
    );
    expect(sanitizeHtml(once)).toBe(once);
  });
});

describe('safeUrl', () => {
  it('accepts relative paths with a single slash, fragments and queries', () => {
    expect(safeUrl('/a/b', {schemes: ['https']})).toBe('/a/b');
    expect(safeUrl('#top', {schemes: ['https']})).toBe('#top');
    expect(safeUrl('?q=1', {schemes: ['https']})).toBe('?q=1');
  });

  it('rejects scheme-relative, backslash and bare relative values', () => {
    expect(safeUrl('//evil.test', {schemes: ['https']})).toBeNull();
    expect(safeUrl('/\\evil.test', {schemes: ['https']})).toBeNull();
    expect(safeUrl('evil.test/x', {schemes: ['https']})).toBeNull();
    expect(safeUrl('', {schemes: ['https']})).toBeNull();
  });
});
