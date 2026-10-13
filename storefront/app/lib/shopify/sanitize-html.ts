// The one HTML sanitiser for Shopify rich content (pages, policies, blog articles; threat T-07). It is an
// allow-list tokenizer and re-serialiser, not a "remove bad things" filter: the output is built only from
// tags and attributes named below, text is re-escaped, and anything unknown is dropped (the text of an
// unknown tag stays, the content of script-like tags goes). It needs no DOM, so it runs on the server and
// in the Workers runtime, and being deterministic it gives the same output during hydration.
//
// What is never emitted: script, style, iframe, object, embed, form controls, event-handler attributes
// (on*), style attributes, and any URL whose scheme is not http, https, mailto or tel.

const MAX_INPUT_LENGTH = 300_000;
const MAX_DEPTH = 40;

const VOID_TAGS = new Set(['br', 'hr', 'img']);

/** Tags whose whole content is removed, not just the tag. */
const DROP_CONTENT_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
  'textarea',
  'select',
  'title',
  'head',
]);

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'sub',
  'sup',
  'small',
  'span',
  'div',
  'ul',
  'ol',
  'li',
  'blockquote',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'img',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'dl',
  'dt',
  'dd',
]);

/** Headings below the page title only: a content `h1` would give the page two. */
const RENAMED_TAGS: Readonly<Record<string, string>> = {h1: 'h2'};

const ALLOWED_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'width', 'height']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  td: new Set(['colspan', 'rowspan']),
};

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  colon: ':',
  tab: '\t',
  newline: '\n',
  sol: '/',
  lpar: '(',
  rpar: ')',
};

/** Decodes the entities that can hide a URL scheme (`jav&#x61;script:`); unknown ones stay as typed. */
function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi,
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

function escapeText(text: string): string {
  // Entities already in the source are inert text; everything else that matters is escaped.
  return text
    .replace(/&(?![a-zA-Z0-9#]{1,32};)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Returns a safe URL or null. Relative paths must start with a single `/`, `#` or `?`; absolute ones must
 * use an allowed scheme. Whitespace and control characters are removed first because browsers ignore
 * them inside a scheme (`java\tscript:`).
 */
export function safeUrl(
  raw: string,
  options: {readonly schemes: readonly string[]},
): string | null {
  const decoded = decodeEntities(raw);
  const compact = stripInvisible(decoded);
  if (compact === '' || compact.includes('\\')) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  if (scheme) {
    return options.schemes.includes(scheme[1].toLowerCase())
      ? decoded.trim()
      : null;
  }
  if (compact.startsWith('//')) return null;
  if (/^[/#?]/.test(compact)) return decoded.trim();
  return null;
}

/** Drops control characters and spaces, which browsers ignore inside a URL scheme. */
function stripInvisible(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0x20 && !(code >= 0x7f && code <= 0x9f)) result += char;
  }
  return result;
}

function cleanAttribute(name: string, value: string): string | null {
  switch (name) {
    case 'href': {
      const url = safeUrl(value, {schemes: ['http', 'https', 'mailto', 'tel']});
      return url === null ? null : url;
    }
    case 'src': {
      const url = safeUrl(value, {schemes: ['https']});
      return url === null ? null : url;
    }
    case 'width':
    case 'height':
    case 'colspan':
    case 'rowspan':
      return /^\d{1,4}$/.test(value) ? value : null;
    case 'scope':
      return /^(row|col|rowgroup|colgroup)$/.test(value) ? value : null;
    default:
      return decodeEntities(value).slice(0, 500);
  }
}

const TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)(?:>|$)|<[!?][^>]*>?/g;
const ATTRIBUTE =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function renderAttributes(tag: string, rawAttributes: string): string {
  const allowed = ALLOWED_ATTRIBUTES[tag];
  if (!allowed) return '';
  const seen = new Set<string>();
  let output = '';
  for (const match of rawAttributes.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    if (!allowed.has(name) || seen.has(name)) continue;
    const cleaned = cleanAttribute(
      name,
      match[2] ?? match[3] ?? match[4] ?? '',
    );
    if (cleaned === null) continue;
    seen.add(name);
    output += ` ${name}="${escapeAttribute(cleaned)}"`;
  }
  if (tag === 'a' && seen.has('href')) output += ' rel="noopener noreferrer"';
  return output;
}

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  const input =
    html.length > MAX_INPUT_LENGTH ? html.slice(0, MAX_INPUT_LENGTH) : html;

  let output = '';
  const open: string[] = [];
  let last = 0;
  let skipUntil: string | null = null;

  for (const match of input.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    const text = input.slice(last, index);
    last = index + match[0].length;
    if (skipUntil === null) output += escapeText(text);

    const [, closing, rawName, rawAttributes = ''] = match;
    if (rawName === undefined) continue; // comment, doctype or processing instruction: dropped

    const name = rawName.toLowerCase();
    if (skipUntil !== null) {
      if (closing && name === skipUntil) skipUntil = null;
      continue;
    }
    if (!closing && DROP_CONTENT_TAGS.has(name)) {
      if (!/\/\s*$/.test(rawAttributes)) skipUntil = name;
      continue;
    }

    const tag = RENAMED_TAGS[name] ?? name;
    if (!ALLOWED_TAGS.has(tag)) continue; // unknown tag: its text stays, the tag goes

    if (closing) {
      const position = open.lastIndexOf(tag);
      if (position === -1) continue; // an end tag without a start tag
      while (open.length > position) output += `</${open.pop()}>`;
      continue;
    }

    if (VOID_TAGS.has(tag)) {
      output += `<${tag}${renderAttributes(tag, rawAttributes)}>`;
    } else if (open.length < MAX_DEPTH) {
      output += `<${tag}${renderAttributes(tag, rawAttributes)}>`;
      open.push(tag);
    }
  }

  if (skipUntil === null) output += escapeText(input.slice(last));
  while (open.length > 0) output += `</${open.pop()}>`;
  return output;
}
