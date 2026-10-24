import {describe, expect, it} from 'vitest';
import {anchorHeadings} from '~/components/SafeHtml';
import {
  MIN_TOC_ENTRIES,
  capText,
  extractFaqPairs,
  hasVisibleContent,
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
