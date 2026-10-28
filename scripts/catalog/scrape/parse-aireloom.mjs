// Aireloom (WordPress) product pages to scraped products. The site shows one price per model ("Queen starting at $3,699"), so
// each product has the Queen size only; the other sizes have no price on the site.
import { metaContent, pageTitle, visibleText } from './html.mjs';
import { benefitsFrom, classify, clip, comfortFrom, heightFrom, mattressTypeFrom, oneLine, toCents } from './model.mjs';

/** @param {string} html @returns {string} article text, header and footer chrome removed */
function mainText(html) {
  const body = html.replace(/<(header|footer|nav)[\s\S]*?<\/\1>/gi, ' ');
  return visibleText(body);
}

/**
 * @param {{ brand: string, origin: string, slug: string }} site
 * @param {string} html
 * @param {string} url
 * @returns {import('./build.mjs').ScrapedProduct | null}
 */
export function parseAireloomPage(site, html, url) {
  const handle = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
  const heading = oneLine(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, ' ') ?? '');
  const rawTitle = heading || pageTitle(html).split(' - ')[0];
  const text = mainText(html);
  const priced = /(?:([A-Za-z ]+?)\s+)?starting at\s+\$([\d,]+(?:\.\d\d)?)/i.exec(text);
  if (!priced) return null;
  const sizeLabel = oneLine(priced[1] ?? '').replace(/^.*\b(Twin XL|Twin|Full|Queen|King|California King)$/i, '$1');
  const size = /^(Twin XL|Twin|Full|Queen|King|California King)$/i.test(sizeLabel) ? sizeLabel.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Queen';
  const title = /pillow|mattress/i.test(rawTitle) ? rawTitle : `${rawTitle} Mattress`;
  const { kind, productType } = classify({ title, handle });
  if (kind === 'skip') return null;

  const start = text.indexOf(heading);
  const afterHeading = start >= 0 ? text.slice(start + heading.length) : text;
  const description = oneLine(afterHeading.slice(0, afterHeading.search(/\s(Queen|King|Twin|Full)? ?starting at/i) > 0 ? afterHeading.search(/\s(Queen|King|Twin|Full)? ?starting at/i) : 600));
  const qualityBlock = /<div class="product-quality">([\s\S]*?)<\/div>\s*<\/div>\s*(?:<div class="[^"]*(?:btn|button|action)|<a )/i.exec(html)?.[1] ?? html.slice(html.indexOf('product-quality'), html.indexOf('product-quality') + 3000);
  const bullets = [...qualityBlock.matchAll(/<p>([^<]{2,60})<\/p>/g)].map((m) => oneLine(m[1])).filter((b) => !/^write a review$/i.test(b)).slice(0, 12);
  const reasons = bullets.join(' ');
  // "Fabric/Quilt: a, b, c" pairs from the Features panel.
  const featureBlock = html.slice(html.indexOf('featured-toggle-content'), html.indexOf('featured-toggle-content') + 6000);
  const specs = {};
  for (const item of featureBlock.matchAll(/<p class="title">([^<]+)<\/p>\s*<ul>([\s\S]*?)<\/ul>/g)) {
    const entries = [...new Set([...item[2].matchAll(/<li>([^<]+)<\/li>/g)].map((m) => oneLine(m[1])))];
    if (entries.length) specs[oneLine(item[1])] = clip(entries.join('; '), 190);
  }
  const features = Object.values(specs).join(' ');
  const profile = /Profile\s+(\d{1,2}(?:\s1\/2|\.\d)?)\s*(?:["”″]|&#8243;|in)/i.exec(text)?.[1];

  const uploads = [...new Set([...html.matchAll(/https:\/\/aireloom\.com\/wp-content\/uploads\/[^"'\s)]+\.(?:jpe?g|png|webp)/gi)].map((m) => m[0]))]
    .filter((src) => !/-\d{2,4}x\d{2,4}\.\w+$/.test(src) && !/collectionthumbnail|logo|icon|badge/i.test(src));
  const ogImage = metaContent(html, 'og:image');
  const images = [...new Set([ogImage, ...uploads].filter(Boolean))].slice(0, 8).map((src) => ({ src, alt: title }));
  const haystack = `${title} ${reasons} ${features}`;
  const comfort = kind === 'Mattress' ? comfortFrom(`${title} ${handle.replace(/-/g, ' ')}`) : null;

  return {
    brand: site.brand,
    source: site.slug,
    sourceUrl: url,
    sourceHandle: handle,
    title,
    kind,
    productType,
    description: description.slice(0, 1500),
    bullets,
    specs,
    comfort,
    mattressType: kind === 'Mattress' ? mattressTypeFrom(`${title} ${reasons} ${features}`) : null,
    heightInches: kind === 'Mattress' ? heightFrom(profile ? `${profile.replace(/\s1\/2/, '.5')}"` : '') ?? heightFrom(text) : null,
    benefits: kind === 'Mattress' ? benefitsFrom(haystack) : [],
    options: [{ name: 'Size', values: [size] }],
    variants: [{ sku: '', options: [size], priceCents: toCents(priced[2]) ?? 0, compareAtCents: null, image: null, dimensions: '' }],
    images,
    seoTitle: pageTitle(html).replace(/\s*\|\s*AIRELOOM$/i, ''),
    seoDescription: clip(metaContent(html, 'description') || description, 160),
    notes: [`The site publishes only the ${size} price ("starting at"); the other sizes have no price on the site.`],
    updatedAt: '',
  };
}
