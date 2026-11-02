// The twelve brands' logos that ship with the storefront, in `public/brand-logos/`. Pure data, no framework imports.
//
// Provenance: supplied by the owner 2026-11-02 (folder `mattress fitness images/brands-logo/`). Each is the supplied
// file trimmed to its artwork, shrunk to 400 px on its longest side and exported as WebP; the four that came on an
// opaque white background have it made transparent so they sit on the paper header as well as on white tiles. Artwork
// is otherwise unchanged. Permission to use the brands' marks is still pending (D4): the files are a fallback for a
// brand entry that has no `logo` in admin, and an admin logo always wins.

import type {ImageView} from '~/lib/shopify/types';

type BundledLogo = {
  readonly file: string;
  readonly width: number;
  readonly height: number;
};

/** Keyed by the brand's page handle (the seeded `brand` entries, scripts/setup/seed-entries.mjs). */
const LOGOS: Readonly<Record<string, BundledLogo>> = {
  aireloom: {file: 'aireloom', width: 400, height: 72},
  beautyrest: {file: 'beautyrest', width: 400, height: 105},
  'brooklyn-bedding': {file: 'brooklyn-bedding', width: 400, height: 108},
  casper: {file: 'casper', width: 225, height: 69},
  helix: {file: 'helix', width: 400, height: 78},
  kingsdown: {file: 'kingsdown', width: 400, height: 172},
  molecule: {file: 'molecule', width: 400, height: 51},
  puffy: {file: 'puffy', width: 400, height: 89},
  sealy: {file: 'sealy', width: 399, height: 341},
  serta: {file: 'serta', width: 400, height: 299},
  'stearns-and-foster': {file: 'stearns-and-foster', width: 389, height: 126},
  'tempur-pedic': {file: 'tempur-pedic', width: 220, height: 60},
};

/** "Stearns & Foster" and "stearns-and-foster" are the same key. */
function keyOf(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The bundled logo for a brand, matched by its handle or its name; null for a brand that has none. The result has the
 * shape of an admin image, with the empty alt the callers already use (the brand name is written beside the logo).
 */
export function bundledBrandLogo(
  ...keys: readonly (string | null | undefined)[]
): ImageView | null {
  for (const raw of keys) {
    const logo = raw ? LOGOS[keyOf(raw)] : undefined;
    if (logo) {
      return {
        id: null,
        url: `/brand-logos/${logo.file}.webp`,
        altText: null,
        width: logo.width,
        height: logo.height,
      };
    }
  }
  return null;
}
