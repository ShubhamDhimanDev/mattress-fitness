// Pure logic behind the header search combobox (REQ-SRCH-001, NFR-003): turning Shopify's predictive search
// result into one flat, ordered list of options, and the keyboard movement through that list. No React and
// no Shopify client here, so the ARIA behaviour is unit-tested without a browser.

import type {MoneyV2Like} from '~/lib/money';

/** The result shape the `/search?predictive` loader returns; only the fields the options need. */
type TrackedItem = {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly trackingParameters?: string | null;
};

type ImageLike = {
  readonly url: string;
  readonly width?: number | null;
  readonly height?: number | null;
};

export type PredictiveItems = {
  readonly queries: readonly {
    readonly text: string;
    readonly trackingParameters?: string | null;
  }[];
  readonly products: readonly (TrackedItem & {
    readonly selectedOrFirstAvailableVariant?: {
      readonly image?: ImageLike | null;
      readonly price: MoneyV2Like;
    } | null;
  })[];
  readonly collections: readonly (TrackedItem & {
    readonly image?: ImageLike | null;
  })[];
  readonly pages: readonly TrackedItem[];
  readonly articles: readonly (TrackedItem & {
    readonly blog: {readonly handle: string};
    readonly image?: ImageLike | null;
  })[];
};

export type SuggestionKind =
  'query' | 'product' | 'collection' | 'page' | 'article' | 'all';

export type SuggestionOption = {
  readonly kind: SuggestionKind;
  /** Position in the flat list; the DOM id and `aria-activedescendant` are derived from it. */
  readonly index: number;
  readonly label: string;
  readonly href: string;
  readonly image: ImageLike | null;
  readonly price: MoneyV2Like | null;
};

export type SuggestionGroup = {
  readonly id: string;
  /** Null for the closing "view all results" option, which has no heading. */
  readonly heading: string | null;
  readonly options: readonly SuggestionOption[];
};

export const SEARCH_PATH = '/search';
const MAX_TERM_LENGTH = 100;

/** `/search?q=<term>`: URLSearchParams encodes the term, so "&" or "#" in it cannot change the URL. */
export function searchHref(term: string): string {
  return `${SEARCH_PATH}?${new URLSearchParams({q: term.slice(0, MAX_TERM_LENGTH)}).toString()}`;
}

/**
 * A resource link carrying the search term and Shopify's tracking parameters. The parameters are parsed and
 * re-serialised rather than appended as text, so whatever the API returns can only ever be query pairs.
 */
function trackedHref(
  path: string,
  term: string,
  trackingParameters: string | null | undefined,
): string {
  const params = new URLSearchParams({q: term.slice(0, MAX_TERM_LENGTH)});
  if (trackingParameters) {
    for (const [name, value] of new URLSearchParams(trackingParameters)) {
      if (name !== 'q') params.append(name, value);
    }
  }
  return `${path}?${params.toString()}`;
}

type Draft = Omit<SuggestionOption, 'index'>;

/**
 * Groups in display order, with the closing "view all results" option last. `term` is the shopper's current
 * text and is what the final option searches for.
 */
export function buildSuggestionGroups(
  items: PredictiveItems,
  term: string,
): SuggestionGroup[] {
  const drafts: {id: string; heading: string | null; options: Draft[]}[] = [
    {
      id: 'queries',
      heading: 'Suggested searches',
      options: items.queries
        .filter((query) => query.text.trim() !== '')
        .map((query) => ({
          kind: 'query' as const,
          label: query.text,
          href: searchHref(query.text),
          image: null,
          price: null,
        })),
    },
    {
      id: 'products',
      heading: 'Products',
      options: items.products.map((product) => ({
        kind: 'product' as const,
        label: product.title,
        href: trackedHref(
          `/products/${encodeURIComponent(product.handle)}`,
          term,
          product.trackingParameters,
        ),
        image: product.selectedOrFirstAvailableVariant?.image ?? null,
        price: product.selectedOrFirstAvailableVariant?.price ?? null,
      })),
    },
    {
      id: 'collections',
      heading: 'Collections',
      options: items.collections.map((collection) => ({
        kind: 'collection' as const,
        label: collection.title,
        href: trackedHref(
          `/collections/${encodeURIComponent(collection.handle)}`,
          term,
          collection.trackingParameters,
        ),
        image: collection.image ?? null,
        price: null,
      })),
    },
    {
      id: 'pages',
      heading: 'Pages',
      options: items.pages.map((page) => ({
        kind: 'page' as const,
        label: page.title,
        href: trackedHref(
          `/pages/${encodeURIComponent(page.handle)}`,
          term,
          page.trackingParameters,
        ),
        image: null,
        price: null,
      })),
    },
    {
      id: 'articles',
      heading: 'Articles',
      options: items.articles.map((article) => ({
        kind: 'article' as const,
        label: article.title,
        href: trackedHref(
          `/blogs/${encodeURIComponent(article.blog.handle)}/${encodeURIComponent(article.handle)}`,
          term,
          article.trackingParameters,
        ),
        image: article.image ?? null,
        price: null,
      })),
    },
    {
      id: 'all',
      heading: null,
      options: [
        {
          kind: 'all' as const,
          label: `View all results for “${term}”`,
          href: searchHref(term),
          image: null,
          price: null,
        },
      ],
    },
  ];

  let index = 0;
  return drafts
    .filter((group) => group.options.length > 0)
    .map((group) => ({
      id: group.id,
      heading: group.heading,
      options: group.options.map((option) => ({...option, index: index++})),
    }));
}

export function flattenOptions(
  groups: readonly SuggestionGroup[],
): SuggestionOption[] {
  return groups.flatMap((group) => group.options);
}

/** Number of real suggestions (everything except the closing "view all" option). */
export function suggestionCount(groups: readonly SuggestionGroup[]): number {
  return flattenOptions(groups).filter((option) => option.kind !== 'all')
    .length;
}

export function optionDomId(prefix: string, index: number): string {
  return `${prefix}-option-${index}`;
}

export type ActiveMoveKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

/**
 * Next active option for a navigation key. -1 means "none; focus is on the text". ArrowDown from the
 * last option and ArrowUp from none both wrap, so the list is a loop and every option is reachable from
 * either direction (WAI-ARIA combobox pattern). Home and End jump to the first and last option; the field
 * only hands them over while an option is highlighted, so the caret keys keep working in the text.
 */
export function moveActive(
  current: number,
  count: number,
  key: ActiveMoveKey,
): number {
  if (count <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return current + 1 >= count ? 0 : current + 1;
  return current <= 0 ? count - 1 : current - 1;
}

/** The text a screen reader hears when suggestions change. Empty while loading, so nothing is read twice. */
export function suggestionAnnouncement(args: {
  count: number;
  loading: boolean;
}): string {
  if (args.loading) return '';
  if (args.count === 0) return 'No suggestions. Press Enter to search.';
  return `${args.count} ${args.count === 1 ? 'suggestion' : 'suggestions'} available. Use the up and down arrow keys to review, Enter to select.`;
}
