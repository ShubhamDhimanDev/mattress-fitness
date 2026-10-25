import {describe, expect, it} from 'vitest';
import {anchorHeadings} from '~/components/SafeHtml';
import {
  MAX_FAQ_PAIRS,
  MAX_HEADINGS,
  MAX_TOC_ENTRIES,
  MIN_TOC_ENTRIES,
  cleanBody,
  capText,
  extractFaqPairs,
  hasVisibleContent,
  pageHasContent,
  plainText,
  scanHeadings,
} from '~/lib/pages/content-pages-html';
import {sanitizeHtml} from '~/lib/shopify/sanitize-html';

// REQ-CNT-001: structure read from sanitised page html (table of contents, anchors, FAQ pairs, plain text).

const clean = (html: string) => sanitizeHtml(html);

describe('REQ-CNT-001 table of contents', () => {
  it('lists the h2 and h3 headings in order with their level and a stable anchor', () => {
    const html = clean(
      '<h2>Delivery</h2><p>x</p><h3>Same day</h3><p>y</p><h2>Returns</h2>',
    );
    const {anchors, toc} = scanHeadings(html);
    expect(toc).toEqual([
      {id: 'section-delivery', text: 'Delivery', level: 2},
      {id: 'section-same-day', text: 'Same day', level: 3},
      {id: 'section-returns', text: 'Returns', level: 2},
    ]);
    expect(anchors).toEqual(toc.map((entry) => entry.id));
  });

  it('makes repeated headings unique and gives a letterless heading its position', () => {
    const {anchors} = scanHeadings(
      clean(
        '<h2>FAQ</h2><h2>FAQ</h2><h2>FAQ</h2><h3>???</h3><h3>&#x1F600;</h3>',
      ),
    );
    expect(anchors).toEqual([
      'section-faq',
      'section-faq-2',
      'section-faq-3',
      'section-4',
      'section-5',
    ]);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it('keeps the anchor list aligned with the headings when one has no text', () => {
    const {anchors, toc} = scanHeadings(
      clean('<h2>One</h2><h2></h2><h2>Three</h2>'),
    );
    expect(anchors).toEqual(['section-one', 'section-2', 'section-three']);
    expect(toc.map((entry) => entry.text)).toEqual(['One', 'Three']);
  });

  it('takes tags and entities out of the heading text', () => {
    const {toc} = scanHeadings(
      clean('<h2>Sizes &amp; <strong>fit</strong></h2>'),
    );
    expect(toc[0]?.text).toBe('Sizes & fit');
    expect(toc[0]?.id).toBe('section-sizes-fit');
  });

  it('caps long anchors and only ever produces letters, digits and hyphens', () => {
    const {anchors} = scanHeadings(
      clean(
        `<h2>${'long title '.repeat(30)}</h2><h2>&lt;script&gt;alert(1)&lt;/script&gt;</h2>`,
      ),
    );
    for (const id of anchors) {
      expect(id).toMatch(/^section-[a-z0-9-]+$/);
      expect(id.length).toBeLessThanOrEqual('section-'.length + 60);
    }
  });

  it('ignores h4 and below, and a content h1 becomes an h2 so the page keeps one h1', () => {
    const html = clean('<h1>Title in the text</h1><h4>Small</h4><h2>Real</h2>');
    expect(html).not.toContain('<h1');
    expect(html).toContain('<h2>Title in the text</h2>');
    expect(scanHeadings(html).toc.map((entry) => entry.text)).toEqual([
      'Title in the text',
      'Real',
    ]);
  });

  it('survives a badly nested heading without losing the one inside it', () => {
    const html = clean('<h2>Outer <h3>Inner</h3> tail</h2><h2>Next</h2>');
    const {anchors} = scanHeadings(html);
    const openings = html.match(/<h[23]>/g) ?? [];
    expect(anchors).toHaveLength(openings.length);
  });

  it('needs at least three entries before a contents list is worth showing', () => {
    expect(MIN_TOC_ENTRIES).toBe(3);
  });
});

describe('REQ-CNT-001 anchoring headings in the rendered markup', () => {
  it('adds the loader ids to the h2 and h3 tags in order and nothing else', () => {
    const html = clean('<h2>A</h2><p>x</p><h3>B</h3><h4>C</h4>');
    const {anchors} = scanHeadings(html);
    expect(anchorHeadings(html, anchors)).toBe(
      '<h2 id="section-a">A</h2><p>x</p><h3 id="section-b">B</h3><h4>C</h4>',
    );
  });

  it('returns the markup untouched without ids', () => {
    const html = clean('<h2>A</h2>');
    expect(anchorHeadings(html, undefined)).toBe(html);
    expect(anchorHeadings(html, [])).toBe(html);
  });

  it.each(['x" onclick="alert(1)', 'A B', '<b>', '', 'UPPER', 'a'.repeat(81)])(
    'refuses an id that is not plain lower-case letters, digits and hyphens: %j',
    (id) => {
      expect(anchorHeadings('<h2>A</h2>', [id])).toBe('<h2>A</h2>');
    },
  );

  it('does not let page text forge a heading or an id (the sanitiser escapes it)', () => {
    const html = clean(
      '<p>&lt;h2&gt;fake&lt;/h2&gt;</p><h2 id="main-content">Real</h2>',
    );
    const anchored = anchorHeadings(html, scanHeadings(html).anchors);
    // Shopify's own id is dropped by the sanitiser; only ours remains.
    expect(anchored).toContain('<h2 id="section-real">Real</h2>');
    expect(anchored).not.toContain('main-content');
    expect(anchored).not.toContain('<h2>fake');
  });
});

describe('REQ-CNT-001 sanitiser contract the pages rely on (T-07)', () => {
  it.each([
    ['a script', '<p>a</p><script>alert(1)</script>'],
    ['an iframe', '<iframe src="https://evil.example"></iframe><p>a</p>'],
    [
      'a form',
      '<form action="https://evil.example"><input name="x"><button>Go</button></form><p>a</p>',
    ],
    ['an event handler', '<p onclick="alert(1)">a</p>'],
    ['a javascript link', '<a href="javascript:alert(1)">x</a><p>a</p>'],
    ['an object', '<object data="x"></object><p>a</p>'],
  ])('strips %s', (_name, html) => {
    const out = clean(html);
    for (const forbidden of [
      '<script',
      '<iframe',
      '<form',
      '<input',
      '<button',
      '<object',
      'onclick',
      'javascript:',
      'evil.example',
    ]) {
      expect(out, forbidden).not.toContain(forbidden);
    }
    expect(out).toContain('<p>a</p>');
  });

  it('demotes h1 to h2', () => {
    expect(clean('<h1>T</h1>')).toBe('<h2>T</h2>');
  });
});

describe('REQ-CNT-001 plain text and content checks', () => {
  it('reads visible text with spaces between blocks and decoded entities', () => {
    expect(plainText('<p>One</p><p>Two &amp; three</p>')).toBe(
      'One Two & three',
    );
    expect(plainText('a&nbsp;b &#65; &#x42; &unknown;')).toBe(
      'a b A B &unknown;',
    );
    expect(plainText(null)).toBe('');
    expect(plainText('')).toBe('');
  });

  it('keeps a "<" that starts no tag as text', () => {
    expect(plainText('sizes 2 < 3 > 1')).toBe('sizes 2 < 3 > 1');
    expect(plainText('a <b>bold</b> < c')).toBe('a bold < c');
    expect(plainText('<!-- note -->kept')).toBe('kept');
  });

  it('removes control characters and collapses whitespace', () => {
    expect(plainText('a\u0000b\u0007  \n\t c')).toBe('a b c');
  });

  it('strips tags from a hostile SEO string', () => {
    expect(plainText('<script>alert(1)</script>Great <b>mattress</b>')).toBe(
      'Great mattress',
    );
  });

  it('caps text at a word boundary with an ellipsis', () => {
    expect(capText('short', 10)).toBe('short');
    expect(capText('one two three four five', 14)).toBe('one two three…');
    expect(capText('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(capText('x'.repeat(50), 10).length).toBeLessThanOrEqual(10);
  });

  it('does not count a bare <img> whose src the sanitiser dropped', () => {
    const bare = clean('<img src="javascript:alert(1)" alt="x">');
    expect(bare).toContain('<img');
    expect(hasVisibleContent(bare)).toBe(false);
    expect(pageHasContent('<img src="http://insecure.example/a.png">')).toBe(
      false,
    );
  });

  it('applies one rule to a page body: text, non-breaking spaces and images', () => {
    expect(pageHasContent(null)).toBe(false);
    expect(pageHasContent('')).toBe(false);
    expect(pageHasContent('<p>&nbsp;&#160; </p>')).toBe(false);
    expect(pageHasContent('<p>Hello</p>')).toBe(true);
    expect(pageHasContent('<img src="https://cdn.shopify.com/a.png">')).toBe(
      true,
    );
    // Asked twice, answered the same (the answer is remembered per body).
    expect(pageHasContent('<p>Hello</p>')).toBe(true);
  });

  it('treats a page as empty without text or images, and as content with either', () => {
    expect(hasVisibleContent(clean(''))).toBe(false);
    expect(hasVisibleContent(clean('<p> </p><p><br></p>'))).toBe(false);
    expect(hasVisibleContent(clean('<script>alert(1)</script>'))).toBe(false);
    expect(hasVisibleContent(clean('<p>Hello</p>'))).toBe(true);
    expect(
      hasVisibleContent(clean('<img src="https://cdn.example/a.png" alt="">')),
    ).toBe(true);
  });
});

describe('REQ-CNT-001 question and answer pairs for the FAQ page', () => {
  it('reads question headings each followed by a paragraph', () => {
    const html = clean(
      '<h2>How long is delivery?</h2><p>Two days.</p><p>Sometimes three.</p>' +
        '<h3>Can I return it?</h3><p>Yes.</p>',
    );
    expect(extractFaqPairs(html)).toEqual([
      {question: 'How long is delivery?', answer: 'Two days. Sometimes three.'},
      {question: 'Can I return it?', answer: 'Yes.'},
    ]);
  });

  it('skips headings that are not questions and questions with no paragraph after them', () => {
    const html = clean(
      '<h2>Delivery</h2><p>About delivery.</p>' +
        '<h2>What size?</h2><ul><li>Queen</li></ul>' +
        '<h2>Why us?</h2><p>Because.</p>',
    );
    expect(extractFaqPairs(html).map((pair) => pair.question)).toEqual([
      'Why us?',
    ]);
  });

  it('ends an answer at the next heading', () => {
    const html = clean(
      '<h2>One?</h2><p>First.</p><h2>Section title</h2><p>Not part of the answer.</p>',
    );
    expect(extractFaqPairs(html)).toEqual([
      {question: 'One?', answer: 'First.'},
    ]);
  });

  it('gives nothing for a page of plain text and for questions with no answer text', () => {
    expect(extractFaqPairs(clean('<p>Just text</p>'))).toEqual([]);
    expect(extractFaqPairs(clean('<h2>Why?</h2><p> </p>'))).toEqual([]);
    expect(extractFaqPairs(clean(''))).toEqual([]);
  });

  it('keeps answers as plain text, never markup', () => {
    const [pair] = extractFaqPairs(
      clean(
        '<h2>Safe?</h2><p>Yes <a href="https://x.example">see this</a><script>alert(1)</script></p>',
      ),
    );
    expect(pair?.answer).toBe('Yes see this');
  });

  it('caps a very long answer', () => {
    const [pair] = extractFaqPairs(
      clean(`<h2>Long?</h2><p>${'word '.repeat(3000)}</p>`),
    );
    expect(pair?.answer.length).toBeLessThanOrEqual(5000);
  });
});

// Security review C-M1, C-L1, C-L2, C-I4: a hostile page must stay cheap and bounded.
function elapsedMs(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe('REQ-CNT-001 hostile pages stay cheap and bounded (security C-M1, C-L1)', () => {
  it('scans 8000 identically titled headings in well under 200 ms, with unique anchors', () => {
    const html = clean('<h2>Same</h2><p>x</p>'.repeat(8000));
    let result: ReturnType<typeof scanHeadings> | undefined;
    const ms = elapsedMs(() => {
      result = scanHeadings(html);
    });
    expect(ms).toBeLessThan(200);
    // Only the first MAX_HEADINGS are anchored; the list stays unique.
    expect(result?.anchors).toHaveLength(MAX_HEADINGS);
    expect(new Set(result?.anchors).size).toBe(MAX_HEADINGS);
  });

  it('caps the contents list and the FAQ pairs', () => {
    const headings = Array.from(
      {length: 400},
      (_, i) => `<h2>Question ${i}?</h2><p>Answer ${i}.</p>`,
    ).join('');
    const html = clean(headings);
    expect(scanHeadings(html).toc).toHaveLength(MAX_TOC_ENTRIES);
    expect(extractFaqPairs(html)).toHaveLength(MAX_FAQ_PAIRS);
  });

  it('keeps anchors unique when a heading is named like a generated suffix', () => {
    const {anchors} = scanHeadings(
      clean('<h2>FAQ</h2><h2>FAQ 2</h2><h2>FAQ</h2><h2>FAQ</h2>'),
    );
    expect(new Set(anchors).size).toBe(4);
  });

  it.each([
    ['unclosed tags', '<a'.repeat(32_000)],
    ['unclosed comments', '<!--'.repeat(75_000)],
    ['unclosed scripts', '<script>'.repeat(40_000)],
    ['unclosed styles', '<style '.repeat(40_000)],
    ['lone angle brackets', '< '.repeat(150_000)],
    ['closing tags without end', '</a'.repeat(100_000)],
  ])('strips %s in linear time', (_name, hostile) => {
    expect(elapsedMs(() => plainText(hostile))).toBeLessThan(200);
  });

  it('still reads the text around broken markup', () => {
    // An open tag runs to the first ">" (here the one of <b>), as it always did.
    expect(plainText('before <a href="x and <b>after</b>')).toBe(
      'before after',
    );
    expect(plainText('x <!-- never closed and text')).toBe(
      'x <!-- never closed and text',
    );
    expect(plainText('a<script>1</script>b<STYLE>x</style >c')).toBe('a b c');
  });

  it('treats a body made of zero-width characters as empty', () => {
    expect(plainText('<p>&#8203;&#x200B;\u200b\ufeff</p>')).toBe('');
    expect(pageHasContent('<p>&#8203;</p>')).toBe(false);
  });

  it('sanitises one body once and hands back the same clean text', () => {
    const body = '<h1>T</h1><p>text</p><script>x</script>';
    expect(cleanBody(body)).toBe(sanitizeHtml(body));
    expect(cleanBody(body)).toBe(cleanBody(body));
    expect(cleanBody(null)).toBe('');
  });
});
