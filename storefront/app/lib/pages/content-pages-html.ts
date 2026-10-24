// Reading the structure of a content page from its SANITISED html (P6-09, REQ-CNT-001): a table of contents, the
// anchors for it, plain text for descriptions and the question and answer pairs of a FAQ page.
//
// Everything here takes the output of `sanitizeHtml` (lib/shopify/sanitize-html.ts), never raw Shopify html. That
// matters twice: the sanitiser writes headings as bare `<h2>` and `<h3>` tags (it keeps no attributes on them and
// renames a content `h1` to `h2`, so the page keeps its one h1), and it escapes every `<` in text, so a literal
// tag in the string is always a real tag. The anchors are generated here from the heading text and never taken
// from Shopify, so a page author cannot plant an id that clashes with the site's own (DOM clobbering).
//
// Pure functions with no framework imports; they run in the page loader on the server.

import {sanitizeHtml} from '~/lib/shopify/sanitize-html';

export type TocEntry = {
  readonly id: string;
  readonly text: string;
  readonly level: 2 | 3;
};

/** A table of contents needs somewhere to go: fewer headings than this and none is shown. */
export const MIN_TOC_ENTRIES = 3;

const MAX_ANCHOR_LENGTH = 60;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, body: string) => {
      if (body.startsWith('#')) {
        const code = /^#x/i.test(body)
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : '';
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    },
  );
}

/** Control characters out, whitespace collapsed: text safe to put in a meta tag or a JSON-LD string. */
function tidy(text: string): string {
  let result = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const control = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    result += control ? ' ' : char;
  }
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * The visible text of html as one line. Tags become spaces (so "a</p><p>b" reads "a b"), entities are decoded.
 * Meant for sanitised html, but it also strips tags from any string, which is what the SEO fields need.
 */
export function plainText(html: string | null | undefined): string {
  if (!html) return '';
  // Script and style blocks are removed with their content: it is code, not text a shopper reads.
  const withoutCode = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  // Only real tags and comments go: a "<" that starts no tag ("sizes 2 < 3 > 1") is text.
  const withoutTags = withoutCode.replace(
    /<\/?[a-zA-Z][^>]*>|<!--[\s\S]*?-->/g,
    ' ',
  );
  return tidy(decodeEntities(withoutTags));
}

/** Text cut to `max` characters at a word boundary, with an ellipsis when something was cut. */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * A page "has content" when its sanitised html shows text or an image. An empty page is still served (the
 * shopper may have followed an old link) but with `noindex`, so a blank page never enters search results.
 */
export function hasVisibleContent(cleanHtml: string): boolean {
  // The sanitiser drops an image whose src it refuses, leaving a bare <img>: that shows nothing, so it is no content.
  return plainText(cleanHtml) !== '' || /<img\b[^>]*\ssrc="/.test(cleanHtml);
}

// The footer asks this of up to 15 page bodies on every request, and the answer for a body never changes, so it is
// remembered per body. The map is cleared when full: cheap, and a miss only costs one sanitising pass.
const CONTENT_MEMORY_LIMIT = 64;
const contentMemory = new Map<string, boolean>();

/**
 * The one rule for "this Shopify page has content", used by the footer's existence read and by the page route
 * (through \`hasVisibleContent\`), so the two can never disagree: text after entities are decoded and whitespace
 * (including &nbsp;) is trimmed, or an image the sanitiser keeps. An empty page does not count as a page.
 */
export function pageHasContent(body: string | null | undefined): boolean {
  if (!body) return false;
  const known = contentMemory.get(body);
  if (known !== undefined) return known;
  const answer = hasVisibleContent(sanitizeHtml(body));
  if (contentMemory.size >= CONTENT_MEMORY_LIMIT) contentMemory.clear();
  contentMemory.set(body, answer);
  return answer;
}

function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ANCHOR_LENGTH)
    .replace(/-+$/, '');
}

type Heading = {
  readonly level: 2 | 3;
  readonly text: string;
  /** Where the opening tag starts and where the heading ends (after its closing tag, when it has one). */
  readonly start: number;
  readonly end: number;
};

/**
 * Every h2 and h3, in document order, found by their opening tags so the browser's anchoring (one id per opening
 * tag, see SafeHtml) lines up one to one. A heading's text runs to the next heading tag, which also keeps a badly
 * nested heading from swallowing the one inside it.
 */
function headingsOf(cleanHtml: string): Heading[] {
  const edge = /<\/h[23]>|<h[23]>/g;
  return [...cleanHtml.matchAll(/<h([23])>/g)].map((open) => {
    const start = open.index ?? 0;
    const bodyStart = start + open[0].length;
    edge.lastIndex = bodyStart;
    const next = edge.exec(cleanHtml);
    const bodyEnd = next ? next.index : cleanHtml.length;
    return {
      level: open[1] === '2' ? 2 : 3,
      text: plainText(cleanHtml.slice(bodyStart, bodyEnd)),
      start,
      end:
        next !== null && next[0].startsWith('</')
          ? bodyEnd + next[0].length
          : bodyEnd,
    };
  });
}

export type HeadingScan = {
  /** One anchor per h2/h3 in document order, headings with no text included (so positions line up). */
  readonly anchors: readonly string[];
  /** The headings that have text, for the table of contents. */
  readonly toc: readonly TocEntry[];
};

/**
 * The anchors and the table of contents of a page. Ids are `section-<slug>`, made unique with a numeric suffix;
 * a heading whose text has no letters or digits gets `section-<position>`.
 */
export function scanHeadings(cleanHtml: string): HeadingScan {
  const used = new Set<string>();
  const anchors: string[] = [];
  const toc: TocEntry[] = [];
  let position = 0;
  for (const {level, text} of headingsOf(cleanHtml)) {
    position += 1;
    const base = `section-${slugOf(text) || position}`;
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    anchors.push(id);
    if (text !== '') toc.push({id, text, level});
  }
  return {anchors, toc};
}

export type FaqPair = {readonly question: string; readonly answer: string};

const MAX_QUESTION_LENGTH = 300;
const MAX_ANSWER_LENGTH = 5000;

/**
 * Question and answer pairs, for FAQPage markup, only when the structure is unmistakable: an h2 or h3 whose text
 * ends in a question mark, immediately followed by a paragraph; the answer is the text up to the next heading.
 * Headings that are not questions (section titles) are skipped, and so is a question with no paragraph after it.
 * The markup must describe what the page shows, so a page that does not read this way gets none.
 */
export function extractFaqPairs(cleanHtml: string): FaqPair[] {
  const headings = headingsOf(cleanHtml);
  const pairs: FaqPair[] = [];
  headings.forEach((heading, index) => {
    const question = heading.text;
    if (!/[?？]$/.test(question) || question.length > MAX_QUESTION_LENGTH) {
      return;
    }
    const to = headings[index + 1]?.start ?? cleanHtml.length;
    const segment = cleanHtml.slice(heading.end, to);
    if (!/^\s*<p>/.test(segment)) return;
    const answer = plainText(segment);
    if (answer === '') return;
    pairs.push({question, answer: capText(answer, MAX_ANSWER_LENGTH)});
  });
  return pairs;
}
