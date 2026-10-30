// Static fallback content for the site chrome (REQ-NAV-001, REQ-NAV-002).
// Pure data and types, no framework imports (the phone parser is a pure helper from lib/phone).
// Every URL and label here is a PLACEHOLDER until the client's catalog, Shopify navigation menus and content
// pages exist. The Shopify admin menu (lib/nav-menu.ts, P3B-02) replaces MAIN_NAV when it is present and usable;
// these fixed items remain the fallback when it is absent, empty or its read fails.

import {BRAND_NAME} from '~/lib/brand';
import type {PublicChatConfig} from '~/lib/chat/config';
import {normalizeUsPhone} from '~/lib/phone';

/** The store name in titles, the copyright line and the logo's accessible name: one constant (brand.ts). */
export const SITE_NAME = BRAND_NAME;

export type SupportPhone = {display: string; href: string};

/**
 * Contact number from fictional range 555-0100 to 555-0199, labelled as a placeholder. It is shown only in
 * development (see `resolveSupportPhone`) so layouts can be checked; it must never reach a shopper (B-15).
 */
const DEV_PLACEHOLDER_PHONE: SupportPhone = {
  display: '1-800-555-0100 (dev placeholder)',
  href: 'tel:+18005550100',
};

/**
 * The support phone to show, or null to show none (REQ-CNT-001, B-15). The number is the client's, set in
 * `PUBLIC_SUPPORT_PHONE`; until it is configured, and whenever the value is not a usable US number, no phone
 * link is rendered anywhere. Only development falls back to a clearly labelled placeholder.
 */
export function resolveSupportPhone(
  raw: unknown,
  isDev: boolean,
): SupportPhone | null {
  const parsed = normalizeUsPhone(raw);
  if (parsed) return {display: parsed.display, href: `tel:${parsed.e164}`};
  return isDev ? DEV_PLACEHOLDER_PHONE : null;
}

export type NavLinkItem = {
  kind: 'link';
  id: string;
  label: string;
  to: string;
  /** True for an https link to another site (a Shopify menu item of type HTTP): rendered as a plain anchor. */
  external?: boolean;
  /** Styled as the call to action at the end of the main navigation (the sleep quiz). */
  emphasis?: boolean;
};

export type NavGroupLink = {
  label: string;
  to: string;
  /** True for an https link to another site: rendered as a plain anchor instead of a router link. */
  external?: boolean;
  /**
   * True while the page behind the link and the promise it describes are not supplied by the client. Such a
   * link is never rendered (REQ-CNT-001, B-15); see `publishedLinks`.
   */
  awaitingContent?: boolean;
  /** Position among the footer links of one group, so static links and Shopify page links interleave (P6-09). */
  order?: number;
};

/** Entries the shopper may see: everything except those still waiting for client content. */
export function publishedLinks<T extends {awaitingContent?: boolean}>(
  links: readonly T[],
): T[] {
  return links.filter((link) => link.awaitingContent !== true);
}

export type NavGroup = {
  id: string;
  /** Null for links that sit directly under a top-level item with no group between (Shopify menu, two levels). */
  heading: string | null;
  /** Where the heading itself leads, when the group's menu item has a link of its own. */
  headingTo?: string;
  headingExternal?: boolean;
  links: NavGroupLink[];
};

export type NavMenuItem = {
  kind: 'menu';
  id: string;
  label: string;
  /**
   * Landing page for the whole section, shown as "View all" inside the dropdown. Absent when the Shopify menu
   * item has children but no link of its own.
   */
  to?: string;
  external?: boolean;
  groups: NavGroup[];
};

export type MainNavItem = NavLinkItem | NavMenuItem;

export const SLEEP_QUIZ_LINK: NavLinkItem = {
  kind: 'link',
  id: 'quiz',
  label: 'Sleep quiz',
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

/**
 * The "Shop by ..." links are filtered views of the one mattresses collection, not collections of their own: the
 * collection route already reads `size`, `comfort`, `mattress_type` and the price range from the URL (lib/filters.ts),
 * so they work on any store that has the `mattresses` collection and never 404 on a collection nobody created.
 */
const MATTRESSES_PATH = '/collections/mattresses';

export const MAIN_NAV: readonly MainNavItem[] = [
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
          to: `${MATTRESSES_PATH}?size=${slug(size)}`,
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
          {label: 'Plush', to: `${MATTRESSES_PATH}?comfort=plush`},
          {label: 'Medium', to: `${MATTRESSES_PATH}?comfort=medium`},
          {label: 'Firm', to: `${MATTRESSES_PATH}?comfort=firm`},
        ],
      },
      {
        id: 'mattresses-type',
        heading: 'Shop by type',
        links: [
          {
            label: 'Memory foam',
            to: `${MATTRESSES_PATH}?mattress_type=memory-foam`,
          },
          {label: 'Hybrid', to: `${MATTRESSES_PATH}?mattress_type=hybrid`},
          {
            label: 'Innerspring',
            to: `${MATTRESSES_PATH}?mattress_type=innerspring`,
          },
          {label: 'Latex', to: `${MATTRESSES_PATH}?mattress_type=latex`},
        ],
      },
      {
        id: 'mattresses-price',
        heading: 'Shop by price',
        links: [
          {label: 'Under $500', to: `${MATTRESSES_PATH}?price_max=500`},
          {
            label: '$500 to $1,000',
            to: `${MATTRESSES_PATH}?price_min=500&price_max=1000`,
          },
          {
            label: '$1,000 to $2,000',
            to: `${MATTRESSES_PATH}?price_min=1000&price_max=2000`,
          },
          {label: 'Over $2,000', to: `${MATTRESSES_PATH}?price_min=2000`},
        ],
      },
    ],
  },
  {
    kind: 'menu',
    id: 'foundations',
    label: 'Box Springs & Adjustable Beds',
    to: '/collections/foundations-and-bases',
    groups: [
      {
        id: 'foundations-foundations',
        heading: 'Box springs',
        links: [
          {label: 'All box springs', to: '/collections/box-springs'},
          {label: 'Low profile', to: '/collections/low-profile-foundations'},
        ],
      },
      {
        id: 'foundations-adjustable',
        heading: 'Adjustable beds',
        links: [
          {label: 'All adjustable beds', to: '/collections/adjustable-bases'},
        ],
      },
    ],
  },
  {
    kind: 'menu',
    id: 'furniture',
    label: 'Beds & Furniture',
    to: '/collections/furniture',
    groups: [
      {
        id: 'furniture-beds',
        heading: 'Beds',
        links: [
          {label: 'Bed frames', to: '/collections/bed-frames'},
          {label: 'Headboards', to: '/collections/headboards'},
        ],
      },
      {
        id: 'furniture-bedroom',
        heading: 'Bedroom',
        links: [
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
];

export type UtilityLink = {
  id: string;
  label: string;
  to: string;
  /** On the `chat` entry only: the configured provider (P7-03). The entry renders nothing without it. */
  chat?: PublicChatConfig;
};

/**
 * The utility links that need no Shopify content, and so the default of the bar and the mobile menu. The phone
 * number is rendered separately from SUPPORT_PHONE. The links to the contact page and the chat are added by
 * `buildUtilityLinks` only when they can work (P6-09).
 */
export const UTILITY_LINKS: readonly UtilityLink[] = [
  {id: 'track', label: 'Track order', to: '/track-order'},
];

/** Paths that belong to Shopify-written pages and blogs: a fixed link to one shows only when it exists. */
const SHOPIFY_CONTENT_PATH = /^\/(pages|blogs)\//;

/** The paths of the Shopify pages and blogs that exist with content, from the footer's existence read. */
export function existingContentPaths(
  pages: readonly FooterPageLink[],
): ReadonlySet<string> {
  return new Set(pages.map((page) => page.to));
}

const COLLECTION_PATH = /^\/collections\/([^/?#]+)/;

/** The handles of the collections that exist in Shopify; null when the read failed, which keeps every link. */
export type CollectionHandles = ReadonlySet<string> | null;

// `all` is built into the route (it lists every product), so it never needs a collection of its own.
function collectionExists(to: string, handles: CollectionHandles): boolean {
  const handle = COLLECTION_PATH.exec(to)?.[1];
  return (
    handle === undefined ||
    handle === 'all' ||
    handles === null ||
    handles.has(handle)
  );
}

function linkExists(
  to: string | undefined,
  existing: ReadonlySet<string>,
  collections: CollectionHandles = null,
) {
  if (to === undefined) return true;
  if (!SHOPIFY_CONTENT_PATH.test(to)) return collectionExists(to, collections);
  return existing.has(to);
}

/**
 * The header utility links for the pages that exist. "Contact us" needs the contact page. "Chat with us" is a chat
 * provider call-out (a button, rendered by `ChatCallout`, P7-03): pass `chat: true` only when a provider is configured
 * (`PUBLIC_CHAT_PROVIDER`, Q-011); it then shows only while the widget is loading or ready. The old stand-in, a link to
 * the contact page under a chat label, promised a chat that does not exist and is gone. The entry's `to` is only
 * the fallback the call-out never uses on its own.
 */
export function buildUtilityLinks(
  existing: ReadonlySet<string>,
  options: {readonly chat?: boolean | PublicChatConfig} = {},
): UtilityLink[] {
  return [
    ...UTILITY_LINKS,
    ...(existing.has('/pages/contact')
      ? [{id: 'contact', label: 'Contact us', to: '/pages/contact'}]
      : []),
    ...(options.chat === true || typeof options.chat === 'object'
      ? [
          {
            id: 'chat',
            label: 'Chat with us',
            to: '/pages/contact',
            ...(options.chat === true ? {} : {chat: options.chat}),
          },
        ]
      : []),
  ];
}

/**
 * The fixed navigation without its links to Shopify pages and blogs that do not exist (guides, journal). Groups
 * left empty and menus left with nothing to open are dropped. It applies to the fixed fallback only; a menu
 * edited in Shopify admin is the client's own choice of links.
 */
export function pruneMainNav(
  items: readonly MainNavItem[],
  existing: ReadonlySet<string>,
  collections: CollectionHandles = null,
): MainNavItem[] {
  return items.flatMap((item): MainNavItem[] => {
    if (item.kind === 'link')
      return linkExists(item.to, existing, collections) ? [item] : [];
    const groups = item.groups
      .map((group) => ({
        ...group,
        links: group.links.filter((link) =>
          linkExists(link.to, existing, collections),
        ),
      }))
      .filter((group) => group.links.length > 0);
    const next: NavMenuItem = {...item, groups};
    if (!linkExists(item.to, existing, collections)) delete next.to;
    return groups.length === 0 && next.to === undefined ? [] : [next];
  });
}

/** The fixed navigation for the collections that exist (CR-31): `MAIN_NAV`, pruned. */
export function buildFallbackNav(
  existing: ReadonlySet<string>,
  collections: CollectionHandles = null,
): MainNavItem[] {
  return pruneMainNav(MAIN_NAV, existing, collections);
}

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
 * The three promises in the trust strip under the main menu (CR-31). The wording is the owner's, taken from the
 * reference strip; the terms behind them (delivery area, comfort trial, price match) are still the client's to
 * confirm (Q-008), so the strip states them without linking to pages that may not exist.
 */
export const REASSURANCE_DRAFT: readonly ReassuranceItem[] = [
  {
    id: 'delivery',
    icon: 'truck',
    text: 'Free in-home delivery & setup',
    to: '/pages/delivery-and-shipping',
  },
  {
    id: 'comfort',
    icon: 'shield',
    text: '100% comfort guarantee',
    to: '/pages/comfort-guarantee',
  },
  {
    id: 'price',
    icon: 'tag',
    text: 'Price guarantee',
    to: '/pages/price-guarantee',
  },
];

/** The header strip shows every item that is not held back with `awaitingContent`. */
export const REASSURANCE_ITEMS: readonly ReassuranceItem[] =
  publishedLinks(REASSURANCE_DRAFT);

/** The strip under the menu is the one place the promises show on the home page: no second row or hero note. */
export const HOME_ASSURANCE_ITEMS: readonly ReassuranceItem[] = [];

/**
 * The promotion bar message, from `site_settings.promo_bar_text` and `promo_bar_link` in Shopify admin (read by
 * `lib/shopify/site-settings.ts`). Without text the bar is not rendered (no invented text, B-15). `to` is an
 * allow-listed site path or https URL (`parseAdminLink`); `external` marks the https case. With a link and no
 * `linkLabel` the message text itself is the link.
 */
export type PromoMessage = {
  text: string;
  linkLabel?: string;
  to?: string;
  external?: boolean;
};

export type FooterGroupId = 'support' | 'sleep-guide' | 'about' | 'legal';

export type FooterGroup = {id: string; heading: string; links: NavGroupLink[]};

/** A footer group that Shopify page links can join (the shop-by groups below cannot). */
export type PageFooterGroup = FooterGroup & {id: FooterGroupId};

/**
 * A footer link to a Shopify page, policy or blog that exists and has content (P6-09, REQ-CNT-001). The server
 * builds these from the registry in `lib/pages/content-pages.ts` and a cached existence read; the client only
 * merges them into the groups below, so the registry itself never reaches the browser bundle.
 */
export type FooterPageLink = {
  /** Registry id, for example `page:faq`; quick links name the page they need by it. */
  id: string;
  label: string;
  to: string;
  group: FooterGroupId;
  order: number;
};

/** The links that are not Shopify content: the quiz, the comparison and order tracking. */
export const FOOTER_SUPPORT_GROUPS_DRAFT: readonly PageFooterGroup[] = [
  {
    id: 'support',
    heading: 'Customer support',
    links: [
      // The /track-order route exists (P6-08), and the header's "Track order" always links it. The footer links to it
      // (here and in the quick links) stay held back by `awaitingContent` until the lookup has matched a real order
      // (V-09, V-20, B-15): the footer is the page of promises, the header link is the plain entry point. This
      // difference is a held decision, not a rule; remove the flag when the owner confirms the lookup.
      {
        label: 'Track your order',
        to: '/track-order',
        awaitingContent: true,
        order: 20,
      },
    ],
  },
  {
    id: 'sleep-guide',
    heading: 'Sleep guide',
    links: [
      {label: 'Sleep quiz', to: SLEEP_QUIZ_LINK.to, order: 10},
      {label: 'Compare mattresses', to: COMPARE_PATH, order: 20},
    ],
  },
  {
    id: 'about',
    heading: 'About',
    links: [],
  },
];

export const FOOTER_SUPPORT_GROUPS: readonly PageFooterGroup[] =
  /* @__PURE__ */ FOOTER_SUPPORT_GROUPS_DRAFT.map((group) => ({
    ...group,
    links: publishedLinks(group.links),
  }));

/**
 * One footer group's links: the fixed ones plus every Shopify page link for that group, in `order`. A page that
 * does not exist (or has no text) is simply not in `pages`, so a shopper never meets a link that 404s and nothing
 * stands in for text the client has not written (B-15). The sort is stable, so equal orders keep the fixed
 * links first.
 */
export function footerGroupLinks(
  group: FooterGroupId,
  fixed: readonly NavGroupLink[],
  pages: readonly FooterPageLink[],
): NavGroupLink[] {
  const fromPages = pages.filter((page) => page.group === group);
  return [...fixed, ...fromPages].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
}

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

export type FooterQuickLink = {
  id: string;
  label: string;
  to: string;
  /** True while the page behind the link does not exist yet; such a link is never rendered (see `publishedLinks`). */
  awaitingContent?: boolean;
  /** Registry id of the Shopify page behind the link: shown only when that page exists, at the page's own path. */
  pageId?: string;
};

/**
 * Quick links that lead to a Shopify page: kept when the page exists, pointed at its real path.
 * `awaitingContent` links are dropped first, as before.
 */
export function visibleQuickLinks(
  links: readonly FooterQuickLink[],
  pages: readonly FooterPageLink[],
): FooterQuickLink[] {
  return publishedLinks(links).flatMap((link) => {
    if (link.pageId === undefined) return [link];
    const page = pages.find((candidate) => candidate.id === link.pageId);
    return page ? [{...link, to: page.to}] : [];
  });
}

/**
 * The footer's quick-links row (BA-05): the pages shoppers come back for, first the order and delivery side,
 * then the stores and help side. The Shopify pages (delivery, contact) appear only when the page exists with
 * content (`pageId`, P6-09); `/track-order` waits behind `awaitingContent` (see the support group above; the header links it already). The labels differ from the
 * group links on purpose, so a screen-reader link list does not read two identical names for the same page.
 */
export const FOOTER_QUICK_LINKS_START_DRAFT: readonly FooterQuickLink[] = [
  {
    id: 'track',
    label: 'Order tracking',
    to: '/track-order',
    awaitingContent: true,
  },
  {
    id: 'delivery',
    label: 'Delivery information',
    to: '/pages/delivery-and-shipping',
    pageId: 'page:delivery-and-shipping',
  },
  {id: 'account', label: 'Your account', to: '/account'},
];

export const FOOTER_QUICK_LINKS_END_DRAFT: readonly FooterQuickLink[] = [
  {
    id: 'contact',
    label: 'Get in touch',
    to: '/pages/contact',
    pageId: 'page:contact',
  },
];

/** Every footer link that depends on Shopify content, merged and ready to render. */
export type FooterLinks = {
  supportGroups: readonly FooterGroup[];
  quickStart: readonly FooterQuickLink[];
  quickEnd: readonly FooterQuickLink[];
  legal: readonly NavGroupLink[];
};

/**
 * The whole footer link model for the pages that exist (P6-09). It is built in the root loader, on the server,
 * so the fixed link lists and the merge code stay out of the browser bundle (every route's budget includes the
 * footer); the footer component only renders what it is given. Groups left with no link are dropped.
 */
export function buildFooterLinks(
  pages: readonly FooterPageLink[],
): FooterLinks {
  return {
    supportGroups: FOOTER_SUPPORT_GROUPS.map((group) => ({
      ...group,
      links: footerGroupLinks(group.id, group.links, pages),
    })).filter((group) => group.links.length > 0),
    quickStart: visibleQuickLinks(FOOTER_QUICK_LINKS_START_DRAFT, pages),
    quickEnd: visibleQuickLinks(FOOTER_QUICK_LINKS_END_DRAFT, pages),
    legal: footerGroupLinks('legal', [], pages),
  };
}

/** No Shopify-dependent footer link at all: the footer without link data shows none (never a link that could 404). */
export const NO_FOOTER_LINKS: FooterLinks = {
  supportGroups: [],
  quickStart: [],
  quickEnd: [],
  legal: [],
};

/** Sizes for the temporary home tiles and the size selector samples. */
export const SHOP_BY_SIZE_LINKS: readonly NavGroupLink[] = MATTRESS_SIZES.map(
  (size) => ({label: size, to: `${MATTRESSES_PATH}?size=${slug(size)}`}),
);
