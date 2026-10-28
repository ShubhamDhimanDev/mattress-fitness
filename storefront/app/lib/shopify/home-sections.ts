// Homepage sections edited in Shopify admin (REQ-HOME-001, P3B-13, CR-31). Each `homepage_section` metaobject is one
// block: its `type` says which, `order` places it, `enabled` shows it. Everything here is pure so the
// ordering and the tolerance for bad admin data are unit-tested; the entries are untrusted text (T-07, T-15).
//
// Three kinds of block:
//  - banners (hero, promo-banner, financing) carry their own heading, text, image and link from admin;
//  - catalog blocks (shop-by-size, featured, brands, categories) take their content from the catalog and
//    only borrow the heading, position and visibility from admin;
//  - content blocks (quiz-band, setup-cards, how-it-works, faq, CR-31) carry heading, text, image and
//    link like a banner, and the first three also a list of `homepage_card` entries. A block with nothing to show is
//    left out, so a half-filled admin still gives a complete page.
// `signup` is the email signup (P7-02); it renders nothing unless the signup is configured.

import {cleanText} from '~/lib/catalog/text';
import {parseAdminLink, type AdminLink} from '~/lib/shopify/admin-link';
import {fieldRecord, mapImage} from '~/lib/shopify/common';
import {plainHeading} from '~/lib/shopify/home-highlight';
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
  'quiz-band',
  'setup-cards',
  'how-it-works',
  'faq',
] as const;
export type HomepageSectionType = (typeof HOMEPAGE_SECTION_TYPES)[number];

export const HOMEPAGE_FIELDS = {
  type: 'type',
  heading: 'heading',
  body: 'body',
  image: 'image',
  link: 'link',
  linkLabel: 'link_label',
  cards: 'cards',
  order: 'order',
  enabled: 'enabled',
} as const;

/** The fields of a `homepage_card` entry (scripts/shopify/definitions.json). */
export const HOMEPAGE_CARD_FIELDS = {
  title: 'title',
  text: 'text',
  image: 'image',
  link: 'link',
  linkLabel: 'link_label',
} as const;

const MAX_HEADING_LENGTH = 120;
const MAX_LINK_LABEL_LENGTH = 40;
const MAX_CARD_TITLE_LENGTH = 80;
const MAX_CARD_TEXT_PARAGRAPHS = 2;
const MAX_SECTIONS = 30;
/** Cards a block reads from admin; the three-up setup row shows the first three of them. */
export const MAX_BLOCK_CARDS = 6;
export const MAX_SETUP_CARDS = 3;

export type BannerType = 'hero' | 'promo-banner' | 'financing';
export type CatalogSectionType =
  'shop-by-size' | 'featured' | 'brands' | 'categories';
export type BlockType = 'quiz-band' | 'setup-cards' | 'how-it-works' | 'faq';

/** Heading types that may carry a `[[highlighted phrase]]` (home-highlight.ts); every other heading is stored plain. */
const HIGHLIGHT_TYPES: ReadonlySet<HomepageSectionType> =
  new Set<HomepageSectionType>([
    'hero',
    'quiz-band',
    'setup-cards',
    'how-it-works',
    'faq',
  ]);

export type HomeCard = {
  readonly title: string;
  readonly text: readonly string[];
  readonly image: ImageView | null;
  readonly link: AdminLink | null;
  /** Text of the card's button; without it the title is the link. */
  readonly linkLabel: string | null;
};

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

export type BlockSection = {
  readonly kind: 'block';
  readonly id: string;
  readonly type: BlockType;
  readonly heading: string | null;
  readonly body: readonly string[];
  readonly image: ImageView | null;
  readonly link: AdminLink | null;
  readonly linkLabel: string | null;
  readonly cards: readonly HomeCard[];
};

export type SignupSection = {readonly kind: 'signup'; readonly id: string};

/**
 * The hero used while the store has no usable `homepage_section` entries. (The assurance block is not a section: the page
 * puts it under the first hero whenever the client has published items, see HomeSections.)
 */
export type PlaceholderSection = {
  readonly kind: 'placeholder-hero';
  readonly id: string;
};

export type HomeSection =
  | BannerSection
  | CatalogSection
  | BlockSection
  | SignupSection
  | PlaceholderSection;

type NodeImage = {
  readonly url: string;
  readonly altText?: string | null;
  readonly width?: number | null;
  readonly height?: number | null;
};

type NodeField = {
  readonly key: string;
  readonly value?: string | null;
  readonly reference?: {readonly image?: NodeImage | null} | null;
};

/** A `homepage_card` entry as the list reference returns it (matches the generated query type). */
export type CardNode = {
  readonly id?: string;
  readonly fields: readonly NodeField[];
};

/** The minimal shape of a metaobject node this mapper reads (matches the generated query type). */
export type SectionNode = {
  readonly id: string;
  readonly fields: readonly (NodeField & {
    /** The entries of a list reference (the `cards` field); an entry of another type comes back as an empty object. */
    readonly references?: {
      readonly nodes: readonly (CardNode | Record<string, never>)[];
    } | null;
  })[];
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
  return type === 'shop-by-size' ||
    type === 'featured' ||
    type === 'brands' ||
    type === 'categories'
    ? type
    : null;
}

function blockType(type: HomepageSectionType): BlockType | null {
  return type === 'quiz-band' ||
    type === 'setup-cards' ||
    type === 'how-it-works' ||
    type === 'faq'
    ? type
    : null;
}

function imageIn(fields: readonly NodeField[]): ImageView | null {
  const field = fields.find((f) => f.key === HOMEPAGE_FIELDS.image);
  return mapImage(field?.reference?.image);
}

/** `order` is a whole number in admin; anything else sorts last, in the order Shopify returned it. */
function orderOf(raw: string | undefined): number {
  return raw !== undefined && /^-?\d{1,6}$/.test(raw.trim())
    ? Number(raw.trim())
    : Number.POSITIVE_INFINITY;
}

function labelOf(raw: string | undefined): string | null {
  return cleanText(raw ?? '').slice(0, MAX_LINK_LABEL_LENGTH) || null;
}

/** Cards of the `cards` list, in the order admin set. An entry without a title is skipped, not shown empty. */
function cardsOf(node: SectionNode): HomeCard[] {
  const field = node.fields.find((f) => f.key === HOMEPAGE_FIELDS.cards);
  const cards: HomeCard[] = [];
  for (const entry of field?.references?.nodes ?? []) {
    if (!('fields' in entry) || !entry.fields) continue;
    const fields = fieldRecord(entry.fields);
    const title = cleanText(fields[HOMEPAGE_CARD_FIELDS.title] ?? '').slice(
      0,
      MAX_CARD_TITLE_LENGTH,
    );
    if (title === '') continue;
    cards.push({
      title,
      text: textToParagraphs(fields[HOMEPAGE_CARD_FIELDS.text]).slice(
        0,
        MAX_CARD_TEXT_PARAGRAPHS,
      ),
      image: mapImage(
        entry.fields.find((f) => f.key === HOMEPAGE_CARD_FIELDS.image)
          ?.reference?.image,
      ),
      link: parseAdminLink(fields[HOMEPAGE_CARD_FIELDS.link]),
      linkLabel: labelOf(fields[HOMEPAGE_CARD_FIELDS.linkLabel]),
    });
    if (cards.length === MAX_BLOCK_CARDS) break;
  }
  return cards;
}

type Candidate = {
  readonly order: number;
  readonly position: number;
  readonly section:
    BannerSection | CatalogSection | BlockSection | SignupSection;
};

/** Whether a content block has what it needs to be worth showing; the rest are left out. */
function blockHasContent(block: BlockSection): boolean {
  switch (block.type) {
    case 'quiz-band':
      return block.heading !== null;
    case 'setup-cards':
    case 'how-it-works':
      return block.cards.length > 0;
    case 'faq':
      // Its questions come from the FAQ entries, which this mapper does not see; the page hides an empty one.
      return true;
    default: {
      const unreachable: never = block.type;
      return unreachable;
    }
  }
}

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
  const rawHeading =
    cleanText(fields[HOMEPAGE_FIELDS.heading] ?? '').slice(
      0,
      MAX_HEADING_LENGTH,
    ) || null;
  // A heading that cannot show a highlight must not show the brackets either.
  const heading =
    rawHeading !== null && !HIGHLIGHT_TYPES.has(rawType)
      ? plainHeading(rawHeading) || null
      : rawHeading;

  const banner = bannerType(rawType);
  if (banner) {
    const body = textToParagraphs(fields[HOMEPAGE_FIELDS.body]);
    // A banner with nothing to say is left out rather than shown as an empty box.
    if (heading === null && body.length === 0) return null;
    return {
      order,
      position,
      section: {
        kind: 'banner',
        id,
        type: banner,
        heading,
        body,
        image: imageIn(node.fields),
        link: parseAdminLink(fields[HOMEPAGE_FIELDS.link]),
        linkLabel: labelOf(fields[HOMEPAGE_FIELDS.linkLabel]),
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

  const block = blockType(rawType);
  if (block) {
    const section: BlockSection = {
      kind: 'block',
      id,
      type: block,
      heading,
      body: textToParagraphs(fields[HOMEPAGE_FIELDS.body]),
      image: imageIn(node.fields),
      link: parseAdminLink(fields[HOMEPAGE_FIELDS.link]),
      linkLabel: labelOf(fields[HOMEPAGE_FIELDS.linkLabel]),
      cards: cardsOf(node),
    };
    return blockHasContent(section) ? {order, position, section} : null;
  }
  return {order, position, section: {kind: 'signup', id}};
}

/**
 * The sections to render, in the order set in admin. Disabled, unknown or empty entries are dropped, a
 * catalog block and the FAQ block appear once (the first, by order), and at most 30 are read. Returns [] when
 * nothing usable exists, which tells the caller to use the placeholder layout.
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

  const seenOnce = new Set<string>();
  const sections: HomeSection[] = [];
  for (const {section} of candidates) {
    const onceKey =
      section.kind === 'catalog'
        ? section.type
        : section.kind === 'block' && section.type === 'faq'
          ? section.type
          : null;
    if (onceKey !== null) {
      if (seenOnce.has(onceKey)) continue;
      seenOnce.add(onceKey);
    }
    sections.push(section);
  }
  return sections;
}

export type PromoBannerSection = BannerSection & {
  readonly type: 'promo-banner';
};

/** What the page renders: one section, or a run of consecutive promo banners shown together as one row of offers. */
export type HomeSectionGroup =
  | {readonly kind: 'section'; readonly section: HomeSection}
  | {
      readonly kind: 'offers';
      readonly id: string;
      readonly banners: readonly PromoBannerSection[];
    };

function isPromoBanner(section: HomeSection): section is PromoBannerSection {
  return section.kind === 'banner' && section.type === 'promo-banner';
}

/** A row of offers never holds more than this many cards. */
export const OFFERS_PER_ROW = 3;

/**
 * Consecutive `promo-banner` sections become one `offers` group (a three-up row on a wide screen); a lone banner is a
 * group of one, shown as a full-width card. Order is kept, a banner separated from another by any other section starts
 * a new group, and the fourth in a run starts the next row.
 */
export function groupHomeSections(
  sections: readonly HomeSection[],
): HomeSectionGroup[] {
  const groups: HomeSectionGroup[] = [];
  for (const section of sections) {
    const last = groups[groups.length - 1];
    if (
      isPromoBanner(section) &&
      last?.kind === 'offers' &&
      last.banners.length < OFFERS_PER_ROW
    ) {
      groups[groups.length - 1] = {
        ...last,
        banners: [...last.banners, section],
      };
    } else if (isPromoBanner(section)) {
      groups.push({kind: 'offers', id: section.id, banners: [section]});
    } else {
      groups.push({kind: 'section', section});
    }
  }
  return groups;
}

/**
 * The layout used while the store has no `homepage_section` entries: the sections the page had before they
 * existed, with the hero text marked as a placeholder.
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
];
