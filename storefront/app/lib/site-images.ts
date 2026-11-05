// The client's own photographs that ship with the storefront, in `public/images/`. Pure data, no framework imports.
//
// Provenance: AI-generated images supplied by the owner (2026-11-02, folder `mattress fitness images/`, made from the
// prompts in docs/design/IMAGE_PROMPTS.md). Each is the original, with the generator's corner mark trimmed off, exported as two WebP widths, so a phone
// downloads about 30 kB and a large screen about 100 kB instead of the 2 to 9 MB originals.
//
// These are FALLBACKS and fixed-page pictures. Where Shopify admin supplies an image (homepage blocks and cards), the
// admin image wins; the storefront holds no content of its own beyond these (CLAUDE.md, architecture invariants).
// The photographs are decorative mood photography and render with an empty alt; the sale banner carries text and is the exception (its alt says what it says).

export type SiteImage = {
  /** The larger file, also the fallback `src`. */
  readonly src: string;
  readonly srcSet: string;
  /** Intrinsic size of the larger file, to reserve the layout box. */
  readonly width: number;
  readonly height: number;
};

function siteImage(
  name: string,
  small: number,
  large: number,
  width: number,
  height: number,
): SiteImage {
  const smallUrl = `/images/${name}-${small}.webp`;
  const largeUrl = `/images/${name}-${large}.webp`;
  return {
    src: largeUrl,
    srcSet: `${smallUrl} ${small}w, ${largeUrl} ${large}w`,
    width: large,
    height: Math.round((height * large) / width),
  };
}

export const SITE_IMAGES = {
  /** IMG-01 home hero (5:6 portrait): made bed with a red throw. */
  homeHero: siteImage('hero-bedroom', 640, 804, 804, 965),
  /** IMG-03 sleep quiz band, also the track-order page: a person choosing on their phone. */
  quizChoosing: siteImage('quiz-choosing', 640, 1200, 1308, 1104),
  /** IMG-02 "How it works" and the delivery page: technicians carrying a wrapped mattress. */
  delivery: siteImage('delivery-setup', 640, 1200, 1287, 1222),
  /** IMG-18 financing band: a couple planning their purchase. */
  financing: siteImage('financing-couple', 800, 1600, 2400, 1612),
  /** "Complete your sleep setup" in the order of the redesign plan: protection (IMG-12), base, bedding. */
  homeSetup: [
    siteImage('setup-protection', 640, 1280, 2400, 1612),
    siteImage('setup-base', 640, 1280, 2400, 1612),
    siteImage('setup-bedding', 640, 1280, 2400, 1612),
  ],
  /** Brand offers under the home hero (CR-35): the owner's supplied sale photographs, cropped to the picture alone. */
  offerStearns: siteImage('offer-stearns', 222, 443, 443, 355),
  offerBeautyrestBlack: siteImage('offer-beautyrest-black', 222, 443, 443, 390),
  offerTempur: siteImage('offer-tempur', 222, 443, 443, 378),
  offerCasper: siteImage('offer-casper', 450, 900, 900, 449),
  offerHelix: siteImage('offer-helix', 234, 468, 468, 369),
  offerAdjustable: siteImage('offer-adjustable', 312, 623, 623, 369),
  /** Quiz intro page: a person asleep (the sleep-guide picture, IMG-17). */
  quizIntro: siteImage('quiz-sleeper', 800, 1600, 2400, 1612),
} as const satisfies Record<string, SiteImage | readonly SiteImage[]>;
