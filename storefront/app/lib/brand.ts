// The client's logo and the head tags that come from it. Pure data, no framework imports.
//
// Provenance: the artwork is the client's own logo, supplied by the owner. `mattress-fitness-logo-original.png`
// (1254 px, 543 kB) is kept in the repository as the master in `storefront/brand-source/`, outside `public/`, so
// it is not part of the build and never reaches a browser; the other sizes are resized copies of the same artwork
// in `public/brand/`.

export const BRAND_NAME = 'Mattress Fitness';

/** The client's own tagline, printed on the logo; shown as plain text where the footer has room for it. */
export const BRAND_TAGLINE = 'Rest. Recover. Perform.';

/** The logo red. Used for the browser chrome colour on mobile, nothing else; the page palette is the design system's. */
export const BRAND_THEME_COLOR = '#DE0510';

const BRAND_DIR = '/brand';

export function logoPath(size: 48 | 96 | 180 | 256 | 512): string {
  return `${BRAND_DIR}/mattress-fitness-logo-${size}.png`;
}

/**
 * The wide wordmark (red lettering over a blue rule, transparent background, about 7.8 : 1), cropped from the
 * client's second logo supplied 2026-11-03. It is the header and footer logo; the round logo above stays for the
 * favicon and touch icon, where a wide image would be unreadable at 48 px.
 */
export function wordmarkPath(width: 256 | 512 | 1024): string {
  return `${BRAND_DIR}/mattress-fitness-wordmark-${width}.png`;
}

const WORDMARK_SRCSET = `${wordmarkPath(256)} 256w, ${wordmarkPath(512)} 512w, ${wordmarkPath(1024)} 1024w`;

/**
 * Header logo: shown at 288 CSS px below 1024 px and 368 from 1024 px (classes in BrandLogo), so the
 * width descriptors let the browser pick the file. The explicit width and height (the largest size) reserve the
 * space, so the logo causes no layout shift (CLS).
 */
export const HEADER_LOGO = {
  src: wordmarkPath(512),
  srcSet: WORDMARK_SRCSET,
  sizes: '(min-width: 1024px) 368px, 288px',
  width: 224,
  height: 29,
} as const;

/** Footer logo: shown at 224 CSS px on a white plate (the lettering is dark red and needs a light surface). */
export const FOOTER_LOGO = {
  src: wordmarkPath(512),
  srcSet: WORDMARK_SRCSET,
  sizes: '224px',
  width: 224,
  height: 29,
} as const;

/** Tags every page's head carries; merged with each route's own `links`. */
export const BRAND_HEAD_LINKS = [
  {rel: 'icon', type: 'image/png', sizes: '48x48', href: logoPath(48)},
  {rel: 'apple-touch-icon', sizes: '180x180', href: logoPath(180)},
] as const;
