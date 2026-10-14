// Static fallback content for the site chrome (REQ-NAV-001, REQ-NAV-002).
// Pure data and types, no framework imports. Every URL and label here is a PLACEHOLDER until the client's
// catalog, Shopify navigation menus and content pages exist; the Shopify menu mapping replaces this
// config in P3B-02 and the layout components keep the same prop shapes.

/** Placeholder brand until the brand kit arrives (CLR-013). */
export const SITE_NAME = 'Mattress Store';

/**
 * Placeholder contact number from the reserved fictional range (555-0100 to 555-0199).
 * The real number comes from Shopify admin or the client (CLR-013); never ship this value.
 */
export const SUPPORT_PHONE = {
  display: '1-800-555-0100',
  href: 'tel:+18005550100',
} as const;

export type NavLinkItem = {
  kind: 'link';
  id: string;
  label: string;
  to: string;
  /** Styled as the call to action at the end of the main navigation (the sleep quiz). */
  emphasis?: boolean;
};

export type NavGroupLink = {
  label: string;
  to: string;
  /**
   * True while the page behind the link and the promise it describes are not supplied by the client. Such a
   * link is never rendered (REQ-CNT-001, B-15); see `publishedLinks`.
   */
  awaitingContent?: boolean;
};

/** Entries the shopper may see: everything except those still waiting for client content. */
export function publishedLinks<T extends {awaitingContent?: boolean}>(
  links: readonly T[],
): T[] {
  return links.filter((link) => link.awaitingContent !== true);
}

export type NavGroup = {
  id: string;
  heading: string;
  links: NavGroupLink[];
};

export type NavMenuItem = {
  kind: 'menu';
  id: string;
  label: string;
  /** Landing page for the whole section, shown as "Shop all" inside the dropdown. */
  to: string;
  groups: NavGroup[];
};

export type MainNavItem = NavLinkItem | NavMenuItem;

export const SLEEP_QUIZ_LINK: NavLinkItem = {
  kind: 'link',
  id: 'quiz',
  label: 'Find your mattress',
  to: '/quiz',
  emphasis: true,
};

/** The comparison page (REQ-CMP-001); the same path as `COMPARE_PATH` in lib/pages/compare-view.ts. */
const COMPARE_PATH = '/compare';

const MATTRESS_SIZES = [
  'Twin',
  'Twin XL',
  'Full',
  'Queen',
  'King',
  'California King',
] as const;

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export const MAIN_NAV: readonly MainNavItem[] = [
  {kind: 'link', id: 'sale', label: 'Sale', to: '/collections/sale'},
  {
    kind: 'menu',
    id: 'mattresses',
    label: 'Mattresses',
    to: '/collections/mattresses',
    groups: [
      {
        id: 'mattresses-size',
        heading: 'Shop by size',
        links: MATTRESS_SIZES.map((size) => ({
          label: size,
          to: `/collections/mattresses-${slug(size)}`,
        })),
      },
      {
        id: 'mattresses-brand',
        heading: 'Shop by brand',
        links: [{label: 'All brands', to: '/brands'}],
      },
      {
        id: 'mattresses-comfort',
        heading: 'Shop by comfort',
        links: [
          {label: 'Plush', to: '/collections/plush-mattresses'},
          {label: 'Medium', to: '/collections/medium-mattresses'},
          {label: 'Firm', to: '/collections/firm-mattresses'},
        ],
      },
      {
        id: 'mattresses-type',
        heading: 'Shop by type',
        links: [
          {label: 'Memory foam', to: '/collections/memory-foam-mattresses'},
          {label: 'Hybrid', to: '/collections/hybrid-mattresses'},
          {label: 'Innerspring', to: '/collections/innerspring-mattresses'},
          {label: 'Latex', to: '/collections/latex-mattresses'},
        ],
      },
      {
        id: 'mattresses-price',
        heading: 'Shop by price',
        links: [
          {label: 'Under $500', to: '/collections/mattresses-under-500'},
          {label: '$500 to $1,000', to: '/collections/mattresses-500-1000'},
          {label: '$1,000 to $2,000', to: '/collections/mattresses-1000-2000'},
          {label: 'Over $2,000', to: '/collections/mattresses-over-2000'},
        ],
      },
    ],
  },
  {
    kind: 'menu',
    id: 'foundations',
    label: 'Foundations & Bases',
    to: '/collections/foundations-and-bases',
    groups: [
      {
        id: 'foundations-foundations',
        heading: 'Foundations',
        links: [
          {label: 'Box springs', to: '/collections/box-springs'},
          {label: 'Low profile', to: '/collections/low-profile-foundations'},
        ],
      },
      {
        id: 'foundations-adjustable',
        heading: 'Adjustable bases',
        links: [
          {label: 'All adjustable bases', to: '/collections/adjustable-bases'},
        ],
      },
      {
        id: 'foundations-frames',
        heading: 'Frames',
        links: [{label: 'Bed frames', to: '/collections/bed-frames'}],
      },
    ],
  },
  {
    kind: 'menu',
    id: 'furniture',
    label: 'Furniture',
    to: '/collections/furniture',
    groups: [
      {
        id: 'furniture-bedroom',
        heading: 'Bedroom',
        links: [
          {label: 'Headboards', to: '/collections/headboards'},
          {label: 'Dressers', to: '/collections/dressers'},
          {label: 'Nightstands', to: '/collections/nightstands'},
        ],
      },
    ],
  },
  {
    kind: 'menu',
    id: 'bedding',
    label: 'Bedding',
    to: '/collections/bedding',
    groups: [
      {
        id: 'bedding-essentials',
        heading: 'Essentials',
        links: [
          {label: 'Pillows', to: '/collections/pillows'},
          {label: 'Mattress protectors', to: '/collections/protectors'},
          {label: 'Sheets', to: '/collections/sheets'},
          {label: 'Comforters', to: '/collections/comforters'},
        ],
      },
    ],
  },
  {
    kind: 'link',
    id: 'clearance',
    label: 'Clearance',
    to: '/collections/clearance',
  },
  {
    kind: 'menu',
    id: 'guides',
    label: 'Guides',
    to: '/pages/guides',
    groups: [
      {
        id: 'guides-buying',
        heading: 'Buying guides',
        links: [
          {label: 'Size guide', to: '/pages/size-guide'},
          {label: 'Comfort guide', to: '/pages/comfort-guide'},
          {label: 'Mattress types guide', to: '/pages/mattress-types-guide'},
          {label: 'Adjustable base guide', to: '/pages/adjustable-base-guide'},
        ],
      },
      {
        id: 'guides-help',
        heading: 'Help choosing',
        links: [
          {label: 'Sleep quiz', to: SLEEP_QUIZ_LINK.to},
          {label: 'Compare mattresses', to: COMPARE_PATH},
          {label: 'Sleep journal', to: '/blogs/journal'},
        ],
      },
    ],
  },
];

export type UtilityLink = {id: string; label: string; to: string};

/** Right side of the utility bar. The phone number is rendered separately from SUPPORT_PHONE. */
export const UTILITY_LINKS: readonly UtilityLink[] = [
  {id: 'track', label: 'Track order', to: '/track-order'},
  {id: 'contact', label: 'Contact us', to: '/pages/contact'},
  // Falls back to the contact page until a chat provider is chosen (Q-011, REQ-ANL-004).
  {id: 'chat', label: 'Chat with us', to: '/pages/contact'},
];

export const STORE_LOCATOR_PATH = '/stores';

export type ReassuranceItem = {
  id: string;
  icon: 'truck' | 'shield' | 'tag';
  text: string;
  to: string;
  /**
   * True while the page behind the link and its terms are not supplied by the client. The guarantee wording
   * is invented placeholder text, so pages that make a promise to the shopper must not show it yet.
   */
  awaitingContent?: boolean;
};

/**
 * Every reassurance item the design has room for. The two guarantees are invented placeholder wording: the
 * client has not supplied them (REQ-CNT-001, B-15), so they stay marked `awaitingContent` and are not shown.
 * TODO(REQ-CNT-001): drop `awaitingContent` from the comfort and price items once the client's pages and
 * terms exist.
 */
export const REASSURANCE_DRAFT: readonly ReassuranceItem[] = [
  {
    id: 'delivery',
    icon: 'truck',
    text: 'In-home delivery & setup',
    to: '/pages/delivery-and-shipping',
  },
  {
    id: 'comfort',
    icon: 'shield',
    text: 'Comfort guarantee',
    to: '/pages/comfort-guarantee',
    awaitingContent: true,
  },
  {
    id: 'price',
    icon: 'tag',
    text: 'Price guarantee',
    to: '/pages/price-guarantee',
    awaitingContent: true,
  },
];

/** The header strip and the home page body show the same items: only those whose content exists. */
export const REASSURANCE_ITEMS: readonly ReassuranceItem[] =
  publishedLinks(REASSURANCE_DRAFT);

export const HOME_ASSURANCE_ITEMS: readonly ReassuranceItem[] =
  REASSURANCE_ITEMS;

export type PromoMessage = {text: string; linkLabel?: string; to?: string};

/** Placeholder promotion; the real message is edited in Shopify admin (P3B-13). */
export const DEFAULT_PROMO: PromoMessage = {
  text: 'Sample promotion text goes here.',
  linkLabel: 'Shop the sale',
  to: '/collections/sale',
};

export type FooterGroup = {id: string; heading: string; links: NavGroupLink[]};

/** Footer groups before unpublished links are removed; exported so tests can prove what is held back. */
export const FOOTER_SUPPORT_GROUPS_DRAFT: readonly FooterGroup[] = [
  {
    id: 'support',
    heading: 'Customer support',
    links: [
      {label: 'Contact us', to: '/pages/contact'},
      {label: 'Track your order', to: '/track-order'},
      {label: 'Delivery and shipping', to: '/pages/delivery-and-shipping'},
      {label: 'Financing', to: '/pages/financing'},
      {label: 'Warranty and returns', to: '/pages/warranty-and-returns'},
      {label: 'FAQ', to: '/pages/faq'},
    ],
  },
  {
    id: 'sleep-guide',
    heading: 'Sleep guide',
    links: [
      {label: 'Sleep quiz', to: SLEEP_QUIZ_LINK.to},
      {label: 'Compare mattresses', to: COMPARE_PATH},
      {label: 'Size guide', to: '/pages/size-guide'},
      {label: 'Comfort guide', to: '/pages/comfort-guide'},
      {label: 'Mattress types guide', to: '/pages/mattress-types-guide'},
      {label: 'Adjustable base guide', to: '/pages/adjustable-base-guide'},
      {label: 'Sleep journal', to: '/blogs/journal'},
    ],
  },
  {
    id: 'about',
    heading: 'About',
    links: [
      {label: 'About us', to: '/pages/about'},
      {label: 'Find a store', to: STORE_LOCATOR_PATH},
      // Invented claims until the client supplies the pages and terms (REQ-CNT-001, B-15).
      {
        label: 'Comfort guarantee',
        to: '/pages/comfort-guarantee',
        awaitingContent: true,
      },
      {
        label: 'Price guarantee',
        to: '/pages/price-guarantee',
        awaitingContent: true,
      },
      {label: 'Accessibility', to: '/pages/accessibility'},
    ],
  },
];

export const FOOTER_SUPPORT_GROUPS: readonly FooterGroup[] =
  FOOTER_SUPPORT_GROUPS_DRAFT.map((group) => ({
    ...group,
    links: publishedLinks(group.links),
  }));

function shopGroupFromMenu(
  groupId: string,
  footerHeading: string,
): FooterGroup {
  const mattresses = MAIN_NAV.find(
    (item): item is NavMenuItem =>
      item.kind === 'menu' && item.id === 'mattresses',
  );
  const group = mattresses?.groups.find((g) => g.id === groupId);
  return {
    id: groupId,
    heading: footerHeading,
    links: group ? [...group.links] : [],
  };
}

/** Shop-by groups reuse the mattress menu so the footer and the menu cannot drift apart. */
export const FOOTER_SHOP_GROUPS: readonly FooterGroup[] = [
  shopGroupFromMenu('mattresses-size', 'Shop by size'),
  shopGroupFromMenu('mattresses-brand', 'Shop by brand'),
  shopGroupFromMenu('mattresses-comfort', 'Shop by comfort'),
  shopGroupFromMenu('mattresses-type', 'Shop by type'),
  shopGroupFromMenu('mattresses-price', 'Shop by price'),
];

export const FOOTER_LEGAL_LINKS: readonly NavGroupLink[] = [
  {label: 'Privacy policy', to: '/pages/privacy-policy'},
  {label: 'Terms', to: '/pages/terms'},
  {label: 'Accessibility', to: '/pages/accessibility'},
];

/** Sizes for the temporary home tiles and the size selector samples. */
export const SHOP_BY_SIZE_LINKS: readonly NavGroupLink[] = MATTRESS_SIZES.map(
  (size) => ({label: size, to: `/collections/mattresses-${slug(size)}`}),
);
