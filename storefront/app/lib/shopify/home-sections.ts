// Homepage sections edited in Shopify admin (REQ-HOME-001, P3B-13). Each `homepage_section` metaobject is one
// block: its `type` says which, `order` places it, `enabled` shows it. Everything here is pure so the
// ordering and the tolerance for bad admin data are unit-tested; the entries are untrusted text (T-07, T-15).
//
// Two kinds of block:
//  - banners (hero, promo-banner, financing) carry their own heading, text, image and link from admin;
//  - catalog blocks (shop-by-size, featured, brands, categories) take their content from the catalog and
//    only borrow the heading, position and visibility from admin.
// `signup` is reserved for the email and text-message signup (P7-02); it renders nothing until that exists.

import {cleanText} from '~/lib/catalog/text';
import {parseAdminLink, type AdminLink} from '~/lib/shopify/admin-link';
import {fieldRecord, mapImage} from '~/lib/shopify/common';
import {textToParagraphs} from '~/lib/shopify/rich-text';
import type {ImageView} from '~/lib/shopify/types';

/**
 * The allowed `type` values. scripts/shopify/definitions.json lists the same values as the field's choices;
 * a unit test keeps the two in step.
 */
export const HOMEPAGE_SECTION_TYPES = [
  'hero',
  'promo-banner',
  'shop-by-size',
  'featured',
  'brands',
  'categories',
  'financing',
  'signup',
] as const;
export type HomepageSectionType = (typeof HOMEPAGE_SECTION_TYPES)[number];

export const HOMEPAGE_FIELDS = {
  type: 'type',
  heading: 'heading',
  body: 'body',
  image: 'image',
  link: 'link',
  linkLabel: 'link_label',
  order: 'order',
  enabled: 'enabled',
} as const;

const MAX_HEADING_LENGTH = 120;
const MAX_LINK_LABEL_LENGTH = 40;
const MAX_SECTIONS = 30;

export type BannerType = 'hero' | 'promo-banner' | 'financing';
export type CatalogSectionType =
  'shop-by-size' | 'featured' | 'brands' | 'categories';

export type BannerSection = {
  readonly kind: 'banner';
  readonly id: string;
  readonly type: BannerType;
  readonly heading: string | null;
  readonly body: readonly string[];
  readonly image: ImageView | null;
  readonly link: AdminLink | null;
  /** Text for the call to action; without it the heading is the link. */
  readonly linkLabel: string | null;
};

export type CatalogSection = {
  readonly kind: 'catalog';
  readonly id: string;
  readonly type: CatalogSectionType;
  /** Replaces the section's default heading when set. */
  readonly heading: string | null;
};

export type SignupSection = {readonly kind: 'signup'; readonly id: string};

/** Placeholder blocks that exist only while the store has no usable `homepage_section` entries. */
export type PlaceholderSection =
  | {readonly kind: 'placeholder-hero'; readonly id: string}
  | {readonly kind: 'placeholder-assurance'; readonly id: string};

export type HomeSection =
  BannerSection | CatalogSection | SignupSection | PlaceholderSection;

/** The minimal shape of a metaobject node this mapper reads (matches the generated query type). */
export type SectionNode = {
  readonly id: string;
  readonly fields: readonly {
    readonly key: string;
    readonly value?: string | null;
    readonly reference?: {
      readonly image?: {
        readonly url: string;
        readonly altText?: string | null;
        readonly width?: number | null;
        readonly height?: number | null;
      } | null;
    } | null;
  }[];
};

function isSectionType(value: string): value is HomepageSectionType {
  return (HOMEPAGE_SECTION_TYPES as readonly string[]).includes(value);
}

function bannerType(type: HomepageSectionType): BannerType | null {
  return type === 'hero' || type === 'promo-banner' || type === 'financing'
    ? type
    : null;
}

function catalogType(type: HomepageSectionType): CatalogSectionType | null {
  switch (type) {
    case 'shop-by-size':
    case 'featured':
    case 'brands':
    case 'categories':
      return type;
    case 'hero':
    case 'promo-banner':
    case 'financing':
    case 'signup':
      return null;
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

function imageOf(node: SectionNode): ImageView | null {
  const field = node.fields.find((f) => f.key === HOMEPAGE_FIELDS.image);
  return mapImage(field?.reference?.image);
}

/** `order` is a whole number in admin; anything else sorts last, in the order Shopify returned it. */
function orderOf(raw: string | undefined): number {
  return raw !== undefined && /^-?\d{1,6}$/.test(raw.trim())
    ? Number(raw.trim())
    : Number.POSITIVE_INFINITY;
}

type Candidate = {
  readonly order: number;
  readonly position: number;
  readonly section: BannerSection | CatalogSection | SignupSection;
};

function toCandidate(node: SectionNode, position: number): Candidate | null {
  const fields = fieldRecord(node.fields);
  // Only an explicit "true" shows a section: an unchecked or never-touched box means hidden, as admin shows it.
  if (fields[HOMEPAGE_FIELDS.enabled]?.trim().toLowerCase() !== 'true') {
    return null;
  }
  const rawType = cleanText(fields[HOMEPAGE_FIELDS.type] ?? '').toLowerCase();
  if (!isSectionType(rawType)) return null;

  const order = orderOf(fields[HOMEPAGE_FIELDS.order]);
  const id = `home-section-${position}`;
  const heading =
    cleanText(fields[HOMEPAGE_FIELDS.heading] ?? '').slice(
      0,
      MAX_HEADING_LENGTH,
    ) || null;

  const banner = bannerType(rawType);
  if (banner) {
    const body = textToParagraphs(fields[HOMEPAGE_FIELDS.body]);
    const image = imageOf(node);
    // A banner with nothing to say is left out rather than shown as an empty box.
    if (heading === null && body.length === 0) return null;
    const label =
      cleanText(fields[HOMEPAGE_FIELDS.linkLabel] ?? '').slice(
        0,
        MAX_LINK_LABEL_LENGTH,
      ) || null;
    return {
      order,
      position,
      section: {
        kind: 'banner',
        id,
        type: banner,
        heading,
        body,
        image,
        link: parseAdminLink(fields[HOMEPAGE_FIELDS.link]),
        linkLabel: label,
      },
    };
  }

  const catalog = catalogType(rawType);
  if (catalog) {
    return {
      order,
      position,
      section: {kind: 'catalog', id, type: catalog, heading},
    };
  }
  return {order, position, section: {kind: 'signup', id}};
}

/**
 * The sections to render, in the order set in admin. Disabled, unknown or empty entries are dropped, a
 * catalog block appears once (its first, by order), and at most 30 are read. Returns [] when nothing
 * usable exists, which tells the caller to use the placeholder layout.
 */
export function mapHomeSections(
  nodes: readonly SectionNode[] | null | undefined,
): HomeSection[] {
  const candidates: Candidate[] = [];
  (nodes ?? []).slice(0, MAX_SECTIONS).forEach((node, position) => {
    const candidate = toCandidate(node, position);
    if (candidate) candidates.push(candidate);
  });

  candidates.sort(
    (a, b) =>
      (a.order === b.order ? 0 : a.order < b.order ? -1 : 1) ||
      a.position - b.position,
  );

  const seenCatalog = new Set<CatalogSectionType>();
  const sections: HomeSection[] = [];
  for (const {section} of candidates) {
    if (section.kind === 'catalog') {
      if (seenCatalog.has(section.type)) continue;
      seenCatalog.add(section.type);
    }
    sections.push(section);
  }
  return sections;
}

/**
 * The layout used while the store has no `homepage_section` entries: the sections the page had before they
 * existed, with the hero text and the assurance block marked as placeholders.
 * TODO(P3B-13): remove once the client has created the entries in admin.
 */
export const PLACEHOLDER_HOME_SECTIONS: readonly HomeSection[] = [
  {kind: 'placeholder-hero', id: 'home-placeholder-hero'},
  {
    kind: 'catalog',
    id: 'home-placeholder-size',
    type: 'shop-by-size',
    heading: null,
  },
  {
    kind: 'catalog',
    id: 'home-placeholder-featured',
    type: 'featured',
    heading: null,
  },
  {
    kind: 'catalog',
    id: 'home-placeholder-brands',
    type: 'brands',
    heading: null,
  },
  {
    kind: 'catalog',
    id: 'home-placeholder-categories',
    type: 'categories',
    heading: null,
  },
  {kind: 'placeholder-assurance', id: 'home-placeholder-assurance'},
];
