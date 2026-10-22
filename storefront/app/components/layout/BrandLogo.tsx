import {Link} from 'react-router';
import {BRAND_NAME, FOOTER_LOGO, HEADER_LOGO} from '~/lib/brand';

// React 18 does not know the camelCase `fetchPriority` prop (it warns and drops the hint); the lowercase DOM
// attribute works. Spread from a constant so the type check accepts it.
const HIGH_PRIORITY = {fetchpriority: 'high'};

/**
 * The logo as the home link (REQ-NAV-001). It is above the fold on every page, so it loads eagerly and at high
 * priority; the width and height reserve its space. The link carries the accessible name, so the image's `alt`
 * is not announced a second time, and the wordmark is part of the picture: no visible text repeats it.
 */
export function HeaderLogo() {
  return (
    <Link
      to="/"
      prefetch="intent"
      aria-label={`${BRAND_NAME} home`}
      className="inline-flex min-h-touch items-center"
    >
      <img
        src={HEADER_LOGO.src}
        srcSet={HEADER_LOGO.srcSet}
        width={HEADER_LOGO.width}
        height={HEADER_LOGO.height}
        alt={BRAND_NAME}
        loading="eager"
        decoding="async"
        {...HIGH_PRIORITY}
        className="size-12 md:size-14 lg:size-16"
      />
    </Link>
  );
}

/** The logo in the footer: below the fold, so it loads lazily. Not a link: the header already has the home link. */
export function FooterLogo() {
  return (
    <img
      src={FOOTER_LOGO.src}
      srcSet={FOOTER_LOGO.srcSet}
      sizes={FOOTER_LOGO.sizes}
      width={FOOTER_LOGO.width}
      height={FOOTER_LOGO.height}
      alt={BRAND_NAME}
      loading="lazy"
      decoding="async"
      // The PNG has opaque white corners; the round clip keeps them from showing on the footer's grey surface.
      className="size-24 shrink-0 rounded-full md:size-28"
    />
  );
}
