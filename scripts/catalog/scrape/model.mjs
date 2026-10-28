// The one product shape every parser produces, and the helpers they share: text cleaning, sizes, product kinds and the
// mattress attributes (comfort, type, height, sleep positions, benefits) the project sheet needs.
//
// @typedef {object} Option   { name: string, values: string[] }
// @typedef {object} Variant  { sku: string, options: string[], priceCents: number, compareAtCents: number | null, image: string | null, dimensions: string }
// @typedef {object} ScrapedProduct
//   brand, source (site key), sourceUrl, sourceHandle, title, kind, productType, description (plain text), bullets, specs,
//   comfort, mattressType, heightInches, options, variants, images [{ src, alt }], seoTitle, seoDescription, notes

export const SIZE_ORDER = Object.freeze(['Twin', 'Twin XL', 'Full', 'Queen', 'King', 'California King', 'Split California King']);

/** Standard US mattress dimensions, used only when a source does not state them. */
export const STANDARD_DIMENSIONS = Object.freeze({
  Twin: '38 in x 75 in', 'Twin XL': '38 in x 80 in', Full: '54 in x 75 in', Queen: '60 in x 80 in', King: '76 in x 80 in', 'California King': '72 in x 84 in',
});

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', reg: '®', trade: '™', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', deg: '°', frac12: '½', hellip: '…' };

/** @param {string} text */
export function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z0-9]+);/gi, (whole, name) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);
}

/**
 * HTML to plain text, paragraphs kept as blank lines and list items as lines starting with "- ".
 * @param {string} html
 */
export function htmlToText(html) {
  const text = decodeEntities(
    String(html ?? '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\s*li[^>]*>/gi, '\n- ')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|ul|ol|tr|section)>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' '),
  );
  return text
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** @param {string} text */
export function oneLine(text) {
  return decodeEntities(String(text ?? '')).replace(/\s+/g, ' ').trim();
}

/** @param {string} text */
export function slugify(text) {
  return decodeEntities(String(text ?? ''))
    .replace(/[®™©℠]/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
    .replace(/-+$/g, '');
}

/** @param {string | number | null | undefined} value dollars as text or number */
export function toCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

/** Maps the many spellings of a bed size to the project's size words; anything else is returned trimmed. */
export function normalizeSize(raw) {
  const text = oneLine(raw).replace(/\s*[-–(].*$/, '').trim();
  const splitHead = /^split head (.+)$/i.exec(text);
  if (splitHead) return `Split Head ${normalizeSize(splitHead[1])}`;
  const key = text.toLowerCase().replace(/[^a-z]/g, '');
  const map = {
    twin: 'Twin', twinxl: 'Twin XL', twinlong: 'Twin XL', twinxlong: 'Twin XL', twinextralong: 'Twin XL',
    full: 'Full', double: 'Full', fullxl: 'Full XL', queen: 'Queen', king: 'King', eastking: 'King',
    californiaking: 'California King', calking: 'California King', caking: 'California King', cakingmattress: 'California King',
    splitcaliforniaking: 'Split California King', splitcalking: 'Split California King', splitcaking: 'Split California King',
    splitking: 'Split King', splitqueen: 'Split Queen', shortqueen: 'Short Queen', rvking: 'RV King',
  };
  return map[key] ?? text;
}

/** @param {string} name */
export function looksLikeSizeOption(name) {
  return /\bsize\b/i.test(name);
}

const SKIP = /gift ?card|\bfees?\b|placeholder|haul[- ]?away|recycl|mattress removal|white[- ]glove|protection plan|extend protection|\bloadup\b|smart bed set|\bbundle\b|sample|swatch|uncover your|shipping|remote shipping|service\b/i;

const MATTRESS_NAME = /\bmattress\b|pillow[- ]?top|euro[- ]?top|tight[- ]?top|quilt[- ]?top|smooth[- ]?top|\b(br800|brs900(-c)?|black series|world class|level (one|two|three|four)|perfect sleeper|icomfortpro?|classic (elite|plush|firm|mattress)|five star|dream weaver|plank (firm|luxe)|sleep excellence|masterpiece)\b/;

/**
 * @param {{ title: string, typeHint?: string, handle?: string }} input
 * @returns {{ kind: string, productType: string }}
 */
export function classify({ title, typeHint = '', handle = '' }) {
  const t = `${title} ${handle}`.toLowerCase();
  const hint = typeHint.toLowerCase();
  if (SKIP.test(title) || /gift card|fee|service|bundles|extend protection/i.test(typeHint)) return { kind: 'skip', productType: '' };
  const done = (productType) => ({ kind: productType, productType });
  if (/dog bed|pet bed/.test(t)) return done('Pet Bed');
  if (/replacement (cover|part)|top[- ]only|remotes?\b|bracket|leg kit|foundation pin|corner pin|night ?light|sleep mask|plush (puppy|teddy)|teddy bear/.test(t)) return done('Accessory');
  if (/topper/.test(t)) return done('Mattress Topper');
  if (/protector|encasement|mattress pad|water[- ]?resistant cover/.test(t)) return done('Mattress Protector');
  if (/sheet|pillowcase|pillow case|\bsham/.test(t)) return /pillow protector/.test(t) ? done('Mattress Protector') : done('Sheets');
  // "Pillow Top", "Euro Top" and "Quilt Top" describe a mattress surface, and model names such as "BR800" or "Level Two" carry no
  // product word at all; without this they fell through to Pillow, Bedding or Accessory and never reached the project sheet.
  const looksMattress = MATTRESS_NAME.test(t) && !/foundation|box spring|adjustable|power base|frame|headboard/.test(t);
  if (!looksMattress && /duvet|comforter|blanket|throw|quilt|\brobe|area rug|\brug\b/.test(t)) return done('Bedding');
  if (!looksMattress && !/headboard|bed frame/.test(t) && (/pillow|cushion|neck roll/.test(t) || /pillow/.test(hint))) return done('Pillow');
  if (/adjustable (base|frame|bed)|power base|powerlayer|ease base|baselogic|ascension|lift (pro|max)|\blift\b.*adjust|serenity/.test(t) || /adj-base|adjustable/.test(hint)) return done('Adjustable Base');
  if (/foundation|box spring|stablesupport|bunkie/.test(t) || /foundation/.test(hint)) return done('Foundation');
  if (/bed frame|headboard|footboard|platform|bunk bed|floor bed|nightstand|trundle|\bframe\b|swivel chair|office chair|bracket|leg kit|pins?\b/.test(t) || /frame/.test(hint)) return done('Bed Frame & Furniture');
  if (looksMattress || /mattress|hybrid|crib/.test(t) || /^mattress/.test(hint) || /mattress/.test(handle)) return done('Mattress');
  if (/\bbed\b/.test(t)) return done('Mattress');
  return done('Accessory');
}

/** @param {string} text */
export function comfortFrom(text) {
  const t = ` ${text.toLowerCase()} `;
  if (/ultra[- ]?(plush|soft)/.test(t)) return 'Ultra Plush';
  if (/(extra|ultra)[- ]?firm/.test(t)) return 'Extra Firm';
  if (/medium[- ]?plush|plush[- ]?medium/.test(t)) return 'Plush';
  if (/medium[- ]?firm|cushion[- ]?firm|firm[- ]?medium/.test(t)) return 'Medium';
  if (/luxury[- ]?firm|\bfirm\b/.test(t)) return 'Firm';
  if (/\bplush\b|\bsoft\b|pillow[- ]?top/.test(t)) return 'Plush';
  if (/\bmedium\b/.test(t)) return 'Medium';
  return null;
}

/** @param {string} text */
export function mattressTypeFrom(text) {
  const t = text.toLowerCase();
  if (/hybrid/.test(t)) return 'Hybrid';
  if (/latex/.test(t)) return 'Latex';
  const coil = /coil|innerspring|inner spring|pocketed|spring/.test(t);
  const foam = /foam|tempur|visco|memory/.test(t);
  if (coil && foam) return /innerspring|inner spring/.test(t) ? 'Innerspring' : 'Hybrid';
  if (coil) return 'Innerspring';
  if (/memory foam|tempur|visco/.test(t)) return 'Memory Foam';
  if (foam) return 'Foam';
  return null;
}

/** First "12 inch" / 12" / 12-inch style height in the text. @param {string} text */
export function heightFrom(text) {
  const match = /(\d{1,2}(?:\.\d{1,2}|\s?1\/2)?)\s*(?:["”″]|-?\s?in(?:ch(?:es)?)?\b)/i.exec(text.replace(/&#8243;|&#8221;/g, '"'));
  if (!match) return null;
  const value = Number(match[1].replace(/\s?1\/2/, '.5'));
  return value >= 4 && value <= 30 ? value : null;
}

/** Sleep positions the sheet allows, derived from the comfort level (the rule the first brand sheet used). @param {string | null} comfort */
export function positionsFor(comfort) {
  if (comfort === 'Ultra Plush' || comfort === 'Plush') return ['Side'];
  if (comfort === 'Firm' || comfort === 'Extra Firm') return ['Back', 'Stomach'];
  return ['Back', 'Side'];
}

/** Benefits named in the source text only. @param {string} text */
export function benefitsFrom(text) {
  const t = text.toLowerCase();
  const found = [];
  if (/cool|breathab|temperature|gel/.test(t)) found.push('Cooling');
  if (/pressure[- ]relie|pressure point|contour|conform/.test(t)) found.push('Pressure Relief');
  if (/motion (isolation|separation|transfer)|isolat(es|ion) motion|undisturbed/.test(t)) found.push('Motion Separation');
  if (/back support|lumbar|spinal|alignment|posture/.test(t)) found.push('Back Support');
  if (/organic|eco-?friendly|sustainab|certipur|recycled|natural latex/.test(t)) found.push('Eco-Friendly');
  return found;
}

/** @param {string} text @param {number} max */
export function clip(text, max) {
  const clean = oneLine(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}…`;
}

/** Normalises a title for duplicate detection. @param {string} title */
export function titleKey(title) {
  return slugify(title.replace(/\((free upgrade|new|2\d{3})\)/gi, '')).replace(/-(v\d|2\d{3})$/, '');
}
