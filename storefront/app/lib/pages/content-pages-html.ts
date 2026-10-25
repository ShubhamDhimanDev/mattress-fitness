// Reading the structure of a content page from its SANITISED html (P6-09, REQ-CNT-001): a table of contents, the
// anchors for it, plain text for descriptions and the question and answer pairs of a FAQ page.
//
// Everything here takes the output of `sanitizeHtml` (lib/shopify/sanitize-html.ts), never raw Shopify html. That
// matters twice: the sanitiser writes headings as bare `<h2>` and `<h3>` tags (it keeps no attributes on them and
// renames a content `h1` to `h2`, so the page keeps its one h1), and it escapes every `<` in text, so a literal
// tag in the string is always a real tag. The anchors are generated here from the heading text and never taken
// from Shopify, so a page author cannot plant an id that clashes with the site's own (DOM clobbering).
//
// Limits that keep a hostile page cheap (security review C-M1, C-L1): every scan below is linear in the length of the
// text, and the work that grows with the page is capped: at most MAX_HEADINGS headings are anchored, MAX_TOC_ENTRIES
// are listed and MAX_FAQ_PAIRS are described.
//
// What the sanitiser leaves out is not seen here either (C-I4): it reads at most 300,000 characters of a body, and
// an unclosed head, title, select, template, math, svg, script or style swallows everything after it. A page
// that long, or with such a tag left open, therefore shows less than its author wrote; the content guide says so.
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
/** Headings that get an anchor (the browser anchors by position, so the list must be the same length on both sides). */
export const MAX_HEADINGS = 200;
export const MAX_TOC_ENTRIES = 50;
export const MAX_FAQ_PAIRS = 50;

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
  // Zero-width characters are invisible, so a body made of them alone is empty (\s does not match them).
  return result
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const IS_LETTER = /[a-zA-Z]/;
const CODE_BLOCK_NAME = /^(script|style)(?![a-zA-Z0-9_])/i;

/**
 * Removes comments, tags and the content of script and style blocks in ONE pass over the text. The first version used
 * lazy regular expressions, which rescan to the end of the string for every "<" that never closes: 64 KB of "<a" took
 * 1.8 s and 300 KB of "<!--" 12 s (security review C-L1). Here a search that finds nothing is never repeated, so the
 * work stays linear however the markup is broken. A "<" that starts no tag ("sizes 2 < 3 > 1") stays as text.
 */
function stripMarkup(html: string): string {
  const closers: Record<string, RegExp> = {
    script: /<\/script\s*>/gi,
    style: /<\/style\s*>/gi,
  };
  const missing = {comment: false, tagEnd: false, script: false, style: false};
  let out = '';
  let index = 0;
  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) {
      out += html.slice(index);
      break;
    }
    out += html.slice(index, lt);
    index = lt + 1;

    if (html.startsWith('!--', lt + 1)) {
      const end = missing.comment ? -1 : html.indexOf('-->', lt + 4);
      if (end === -1) {
        missing.comment = true;
        out += '<';
      } else {
        out += ' ';
        index = end + 3;
      }
      continue;
    }

    const closing = html.charCodeAt(lt + 1) === 47;
    const first = html.charAt(lt + (closing ? 2 : 1));
    if (!IS_LETTER.test(first)) {
      out += '<';
      continue;
    }

    if (!closing) {
      const name = CODE_BLOCK_NAME.exec(
        html.slice(lt + 1, lt + 8),
      )?.[1]?.toLowerCase();
      if (name === 'script' || name === 'style') {
        const closer = closers[name];
        if (closer && !missing[name]) {
          closer.lastIndex = lt;
          const found = closer.exec(html);
          if (found) {
            out += ' ';
            index = found.index + found[0].length;
            continue;
          }
          missing[name] = true;
        }
      }
    }

    const gt = missing.tagEnd ? -1 : html.indexOf('>', lt + 1);
    if (gt === -1) {
      missing.tagEnd = true;
      out += '<';
    } else {
      out += ' ';
      index = gt + 1;
    }
  }
  return out;
}

/**
 * The visible text of html as one line. Tags become spaces (so "a</p><p>b" reads "a b"), entities are decoded.
 * Meant for sanitised html, but it also strips tags from any string, which is what the SEO fields need.
 */
export function plainText(html: string | null | undefined): string {
  if (!html) return '';
  return tidy(decodeEntities(stripMarkup(html)));
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

// A body is sanitised once per process and request, not once per question asked of it (security review C-L2): the
// footer's existence read, the page route and the description all need the clean text. The memory is bounded by the
// total characters held, and cleared when full: cheap, and a miss only costs one sanitising pass.
const CLEAN_MEMORY_LIMIT_CHARS = 2_000_000;
const cleanMemory = new Map<string, {clean: string; content: boolean}>();
let cleanMemoryChars = 0;

function remember(body: string) {
  const known = cleanMemory.get(body);
  if (known) return known;
  const clean = sanitizeHtml(body);
  const entry = {clean, content: hasVisibleContent(clean)};
  cleanMemoryChars += body.length + clean.length;
  if (cleanMemoryChars > CLEAN_MEMORY_LIMIT_CHARS) {
    cleanMemory.clear();
    cleanMemoryChars = body.length + clean.length;
  }
  cleanMemory.set(body, entry);
  return entry;
}

/** The sanitised form of a Shopify body, computed once per body (the sanitiser is deterministic). */
export function cleanBody(body: string | null | undefined): string {
  return body ? remember(body).clean : '';
}

/**
 * The one rule for "this Shopify page has content", used by the footer's existence read and by the page route
 * (through `hasVisibleContent`), so the two can never disagree: text after entities are decoded and whitespace
 * (including &nbsp; and zero-width characters) is trimmed, or an image the sanitiser keeps. An empty page does
 * not count as a page.
 */
export function pageHasContent(body: string | null | undefined): boolean {
  return body ? remember(body).content : false;
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
  const found: Heading[] = [];
  for (const open of cleanHtml.matchAll(/<h([23])>/g)) {
    if (found.length >= MAX_HEADINGS) break;
    const start = open.index ?? 0;
    const bodyStart = start + open[0].length;
    edge.lastIndex = bodyStart;
    const next = edge.exec(cleanHtml);
    const bodyEnd = next ? next.index : cleanHtml.length;
    found.push({
      level: open[1] === '2' ? 2 : 3,
      text: plainText(cleanHtml.slice(bodyStart, bodyEnd)),
      start,
      end:
        next !== null && next[0].startsWith('</')
          ? bodyEnd + next[0].length
          : bodyEnd,
    });
  }
  return found;
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
  // The next suffix to try per base id: a page of identical headings must not retry 2, 3, 4 ... for each one (C-M1).
  const nextSuffix = new Map<string, number>();
  const anchors: string[] = [];
  const toc: TocEntry[] = [];
  let position = 0;
  for (const {level, text} of headingsOf(cleanHtml)) {
    position += 1;
    const base = `section-${slugOf(text) || position}`;
    let id = base;
    let suffix = nextSuffix.get(base) ?? 2;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    nextSuffix.set(base, suffix);
    used.add(id);
    anchors.push(id);
    if (text !== '' && toc.length < MAX_TOC_ENTRIES) {
      toc.push({id, text, level});
    }
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
    if (pairs.length >= MAX_FAQ_PAIRS) return;
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
