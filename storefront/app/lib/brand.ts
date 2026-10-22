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
 * Header logo: the 96 px file at 1x and the 180 px file at 2x for a display size of 56 to 64 CSS px. The explicit
 * width and height reserve the space, so the logo causes no layout shift (CLS).
 */
export const HEADER_LOGO = {
  src: logoPath(96),
  srcSet: `${logoPath(96)} 1x, ${logoPath(180)} 2x`,
  width: 56,
  height: 56,
} as const;

/**
 * Footer logo: shown at about 112 CSS px, so the 256 px file covers 1x and 2x screens and the 512 px file is
 * there for larger densities.
 */
export const FOOTER_LOGO = {
  src: logoPath(256),
  srcSet: `${logoPath(256)} 256w, ${logoPath(512)} 512w`,
  sizes: '112px',
  width: 112,
  height: 112,
} as const;

/** Tags every page's head carries; merged with each route's own `links`. */
export const BRAND_HEAD_LINKS = [
  {rel: 'icon', type: 'image/png', sizes: '48x48', href: logoPath(48)},
  {rel: 'apple-touch-icon', sizes: '180x180', href: logoPath(180)},
] as const;
