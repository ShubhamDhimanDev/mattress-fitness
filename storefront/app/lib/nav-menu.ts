// The main navigation built from the Shopify admin menu (REQ-NAV-002, P3B-02). Pure: no framework, no fetch.
//
// The menu is content the client edits in admin, so every part of it is untrusted text (T-07, T-08, T-15):
//  - titles are reduced to plain text and shortened;
//  - links of a Shopify resource type (collection, page, product, blog, article, policy ...) are rebuilt from
//    the handle into one of OUR routes, whatever host or prefix Shopify put in the URL, so a menu can never
//    point at a path this app does not serve or one that walks out of the public routes;
//  - a plain URL ("HTTP" type) is an internal link only when its host is one of our own hosts and the path is
//    on the public allow-list (`parseAdminLink`); any other https URL is kept and marked `external`; anything
//    else (javascript:, data:, http:, credentials, odd characters) drops the item's link.
// The result always has the shape the layout components already render (`MainNavItem`), at most three levels
// of Shopify items: top-level item, group heading, link. A menu with nothing usable gives an empty list and the
// caller keeps the fixed navigation (`MAIN_NAV`), so a missing or broken menu never leaves the header bare.

import {cleanText, hasControlCharacter} from '~/lib/catalog/text';
import {
  SLEEP_QUIZ_LINK,
  type MainNavItem,
  type NavGroup,
  type NavGroupLink,
} from '~/lib/navigation';
import {parseAdminLink} from '~/lib/shopify/admin-link';

/** The header row has room for about eight items next to the quiz call to action. */
export const MAX_TOP_ITEMS = 8;
/** Groups in one dropdown panel. */
export const MAX_GROUPS_PER_ITEM = 8;
/** Links in one group. */
export const MAX_LINKS_PER_GROUP = 12;
/** Longer titles are cut: the layout is built for short labels. */
export const MAX_LABEL_LENGTH = 60;
const MAX_URL_LENGTH = 500;

/** The conventional Shopify handle, for documentation and tests; it is never read unless the deployment names it. */
export const MAIN_MENU_HANDLE = 'main-menu';

/** The `PUBLIC_NAV_MENU_HANDLE` value that explicitly keeps the fixed navigation. */
export const NAV_MENU_OFF = 'none';

/**
 * The menu handle to read, or null to keep the fixed navigation. Opt-in: the Shopify menu is used only when the
 * deployment names a handle in `PUBLIC_NAV_MENU_HANDLE`. A store's default `main-menu` is often just Home and
 * Catalog and would replace the designed navigation, so nothing is read, and no Storefront call is made, when
 * the value is unset, blank, `none` or not a handle (lower-case letters, digits and hyphens as Shopify makes
 * them).
 */
export function resolveMenuHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (value === '' || value === NAV_MENU_OFF) return null;
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(value) ? value : null;
}

export type ResolvedMenuLink = {
  readonly to: string;
  /** True for an https URL on another site. */
  readonly external: boolean;
  /**
   * True when a collection link carried a tag segment (`/collections/king/firm`) that was removed: our collection
   * route has no tag filter, so the link opens the whole collection (see `resourcePath`).
   */
  readonly tagFilterRemoved?: true;
};

export type MenuLinkOptions = {
  /**
   * Lower-case host names that mean "this store" (the store domain and the public site host). A plain URL on
   * one of them is an internal link; on any other host it is external.
   */
  readonly ownHosts?: readonly string[];
};

export type MenuBuildResult = {
  readonly items: MainNavItem[];
  /** Menu entries that did not make it into `items` (bad title, no usable link, duplicate, over a cap). */
  readonly dropped: number;
  /** Links in `items` whose Shopify tag filter was removed, so they open the whole collection (count only). */
  readonly tagLinksUnfiltered: number;
};

// A base for resolving relative URLs; it is never used in an output.
const PLACEHOLDER_ORIGIN = 'https://menu.invalid';

type MenuNode = {
  readonly title: string | null;
  readonly type: string | null;
  readonly url: string | null;
  readonly children: readonly unknown[];
};

function readNode(value: unknown): MenuNode | null {
  if (typeof value !== 'object' || value === null) return null;
  return {
    title:
      'title' in value && typeof value.title === 'string' ? value.title : null,
    type: 'type' in value && typeof value.type === 'string' ? value.type : null,
    url: 'url' in value && typeof value.url === 'string' ? value.url : null,
    children: 'items' in value && Array.isArray(value.items) ? value.items : [],
  };
}

/** Lower-case host names from store-domain and site-URL settings (with or without a scheme). */
export function ownHostsFrom(values: readonly unknown[]): string[] {
  const hosts = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || value.trim() === '') continue;
    const text = value.trim();
    try {
      const url = new URL(text.includes('://') ? text : `https://${text}`);
      if (url.hostname !== '') hosts.add(url.hostname.toLowerCase());
    } catch {
      // An unparseable setting just adds no host.
    }
  }
  return [...hosts];
}

/** A handle is one path segment; it must not be able to change the path it is placed in. */
function validSegment(segment: string | undefined): string | null {
  if (segment === undefined || segment === '') return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  if (
    decoded === '.' ||
    decoded === '..' ||
    /[/\\\s]/.test(decoded) ||
    hasControlCharacter(decoded)
  ) {
    return null;
  }
  return segment;
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/').filter((part) => part !== '');
}

function internal(to: string): ResolvedMenuLink {
  return {to, external: false};
}

type ResourcePath = {
  readonly path: string;
  readonly tagFilterRemoved: boolean;
};

function plainPath(path: string | null): ResourcePath | null {
  return path ? {path, tagFilterRemoved: false} : null;
}

/** Handles are taken from the URL's path; the rest of the URL (host, prefix, query, tag filters) is dropped. */
function resourcePath(
  type: string,
  segments: readonly string[],
): ResourcePath | null {
  switch (type) {
    case 'COLLECTION': {
      // /collections/<handle>[/<tag>]. Shopify filters a collection by product tag with the third segment
      // (`/collections/king/firm`, several tags joined with `+`). Our collection route filters by catalog
      // attributes (lib/filters.ts: comfort, size, brand ...), never by tag, and mapping a tag onto one of those
      // would be a guess about how the client tags products. So the link opens the whole collection and is
      // marked `tagFilterRemoved`; the caller keeps links with different labels apart (otherwise Firm, Plush and
      // Medium under one collection would collapse into one) and counts them for the log. A tag segment that
      // could change the path (dot segments, encoded slashes, whitespace, control characters), or more segments
      // than that, makes the whole link untrusted, so it is rejected.
      if (segments[0] !== 'collections' || segments.length > 3) return null;
      const handle = validSegment(segments[1]);
      if (!handle) return null;
      const tag = segments[2];
      if (tag !== undefined && validSegment(tag) === null) return null;
      return {
        path: `/collections/${handle}`,
        tagFilterRemoved: tag !== undefined,
      };
    }
    case 'PRODUCT': {
      // /products/<handle> or /collections/<c>/products/<handle>. The marker's position is fixed: a collection
      // whose handle is "products" (`/collections/products/products/x`) must not be taken for it.
      let handle: string | null = null;
      if (segments[0] === 'products') {
        handle = validSegment(segments[1]);
      } else if (segments[0] === 'collections' && segments[2] === 'products') {
        handle = validSegment(segments[3]);
      }
      return plainPath(handle ? `/products/${handle}` : null);
    }
    case 'PAGE': {
      const handle = segments[0] === 'pages' ? validSegment(segments[1]) : null;
      return plainPath(handle ? `/pages/${handle}` : null);
    }
    case 'BLOG': {
      const handle = segments[0] === 'blogs' ? validSegment(segments[1]) : null;
      return plainPath(handle ? `/blogs/${handle}` : null);
    }
    case 'ARTICLE': {
      const blog = segments[0] === 'blogs' ? validSegment(segments[1]) : null;
      const article = validSegment(segments[2]);
      return plainPath(blog && article ? `/blogs/${blog}/${article}` : null);
    }
    case 'SHOP_POLICY': {
      const handle =
        segments[0] === 'policies' ? validSegment(segments[1]) : null;
      return plainPath(handle ? `/policies/${handle}` : null);
    }
    default:
      return null;
  }
}

function resolveHttpLink(
  raw: string,
  options: MenuLinkOptions,
): ResolvedMenuLink | null {
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '') return null;
  // Only http(s) (or a relative path, which resolves to the placeholder's https) can name one of our hosts: a
  // non-special scheme such as `javascript://ownhost/pages/x` or `ftp://ownhost/pages/x` also parses with that
  // hostname and must not be taken for an internal link.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // Backslashes were rejected by the caller: URL parsers read them as slashes, which can turn '/\host' into
  // another site. Relative only if resolving did not change the host (it does for '//host').
  const relative = raw.startsWith('/') && url.origin === PLACEHOLDER_ORIGIN;
  const own = (options.ownHosts ?? []).includes(url.hostname.toLowerCase());
  if (relative || own) {
    // The fragment is kept (`/pages/faq#shipping`); the allow-list judges the path before it.
    const parsed = parseAdminLink(`${url.pathname}${url.search}${url.hash}`);
    return parsed && !parsed.external ? internal(parsed.href) : null;
  }
  const parsed = parseAdminLink(raw);
  return parsed?.external ? {to: parsed.href, external: true} : null;
}

/**
 * Where a menu entry leads, as one of our routes or an external https URL; null when it leads nowhere usable
 * (no URL, a type we have no page for, a handle that cannot be trusted, a scheme other than https).
 */
export function resolveMenuLink(
  node: {
    readonly type?: string | null;
    readonly url?: string | null;
  },
  options: MenuLinkOptions = {},
): ResolvedMenuLink | null {
  const type = node.type ?? null;
  const raw = node.url?.trim() ?? '';

  // Types that name a fixed page of ours need no URL.
  if (type === 'FRONTPAGE') return internal('/');
  if (type === 'COLLECTIONS') return internal('/collections');
  if (type === 'CATALOG') return internal('/collections/all');
  if (type === 'SEARCH') return internal('/search');
  if (type === 'CUSTOMER_ACCOUNT_PAGE') return internal('/account');

  if (raw === '' || raw.length > MAX_URL_LENGTH) return null;
  if (/\s/.test(raw) || hasControlCharacter(raw) || raw.includes('\\')) {
    return null;
  }

  if (type === 'HTTP') return resolveHttpLink(raw, options);

  if (type === null) return null;
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const resolved = resourcePath(type, segmentsOf(url));
  if (!resolved) return null;
  return resolved.tagFilterRemoved
    ? {to: resolved.path, external: false, tagFilterRemoved: true}
    : internal(resolved.path);
}

/** Plain-text label, at most `MAX_LABEL_LENGTH` characters (counted as code points); null when nothing is left. */
export function cleanMenuLabel(title: string | null): string | null {
  if (title === null) return null;
  const text = cleanText(title);
  if (text === '') return null;
  const points = Array.from(text);
  const cut =
    points.length <= MAX_LABEL_LENGTH
      ? text
      : points.slice(0, MAX_LABEL_LENGTH).join('').trim();
  return cut === '' ? null : cut;
}

type Context = {
  readonly options: MenuLinkOptions;
  /** The duplicate keys each link list already holds (lists start empty). */
  readonly seen: WeakMap<readonly NavGroupLink[], Set<string>>;
  dropped: number;
  tagLinksUnfiltered: number;
};

type GroupLink = {readonly link: NavGroupLink; readonly tagged: boolean};

function toGroupLink(node: MenuNode, context: Context): GroupLink | null {
  const label = cleanMenuLabel(node.title);
  const resolved = resolveMenuLink(node, context.options);
  if (!label || !resolved) return null;
  return {
    link: resolved.external
      ? {label, to: resolved.to, external: true}
      : {label, to: resolved.to},
    tagged: resolved.tagFilterRemoved === true,
  };
}

/**
 * Two links in one group are the same when they lead to the same place. Links whose tag filter was removed all
 * lead to the whole collection, so for them the label tells them apart: Firm and Plush under one collection stay
 * two links, the same label twice is still one.
 */
function duplicateKey({link, tagged}: GroupLink): string {
  return tagged ? `${link.to}\n${link.label.toLowerCase()}` : link.to;
}

/** Links of one group in menu order, without duplicates and within the cap. */
function collectLinks(
  nodes: readonly unknown[],
  context: Context,
  into: NavGroupLink[] = [],
): NavGroupLink[] {
  let seen = context.seen.get(into);
  if (!seen) {
    seen = new Set<string>();
    context.seen.set(into, seen);
  }
  for (const value of nodes) {
    const node = readNode(value);
    const entry = node ? toGroupLink(node, context) : null;
    if (!entry || seen.has(duplicateKey(entry))) {
      context.dropped += 1;
      continue;
    }
    if (into.length >= MAX_LINKS_PER_GROUP) {
      context.dropped += 1;
      continue;
    }
    seen.add(duplicateKey(entry));
    if (entry.tagged) context.tagLinksUnfiltered += 1;
    into.push(entry.link);
  }
  return into;
}

/**
 * The groups of one top-level item. A child with children of its own is a group (its title the heading); a
 * child without is a plain link, and all such links share one heading-less group at the position of the first.
 */
function buildGroups(
  children: readonly unknown[],
  topId: string,
  context: Context,
): NavGroup[] {
  const groups: NavGroup[] = [];
  let loose: NavGroup | null = null;

  for (const value of children) {
    const node = readNode(value);
    if (!node) {
      context.dropped += 1;
      continue;
    }
    const heading = cleanMenuLabel(node.title);
    const own = resolveMenuLink(node, context.options);
    const links = heading ? collectLinks(node.children, context) : [];

    if (heading && links.length > 0) {
      if (groups.length >= MAX_GROUPS_PER_ITEM) {
        context.dropped += 1;
        continue;
      }
      if (own?.tagFilterRemoved) context.tagLinksUnfiltered += 1;
      groups.push({
        id: `${topId}-g${groups.length}`,
        heading,
        ...(own ? {headingTo: own.to} : {}),
        ...(own?.external ? {headingExternal: true} : {}),
        links,
      });
      continue;
    }

    const single = heading && own ? toGroupLink(node, context) : null;
    if (!single) {
      context.dropped += 1;
      continue;
    }
    if (!loose) {
      if (groups.length >= MAX_GROUPS_PER_ITEM) {
        context.dropped += 1;
        continue;
      }
      loose = {id: `${topId}-g${groups.length}`, heading: null, links: []};
      groups.push(loose);
    }
    collectLinks([node], context, loose.links);
  }
  return groups;
}

function buildTopItem(
  value: unknown,
  index: number,
  context: Context,
): {readonly item: MainNavItem; readonly tagged: boolean} | null {
  const node = readNode(value);
  const label = node ? cleanMenuLabel(node.title) : null;
  if (!node || !label) {
    context.dropped += 1;
    return null;
  }
  const id = `menu-${index}`;
  const own = resolveMenuLink(node, context.options);
  const groups = buildGroups(node.children, id, context);

  if (groups.length === 0) {
    if (!own) {
      context.dropped += 1;
      return null;
    }
    return {
      item: {
        kind: 'link',
        id,
        label,
        to: own.to,
        ...(own.external ? {external: true} : {}),
      },
      tagged: own.tagFilterRemoved === true,
    };
  }
  return {
    item: {
      kind: 'menu',
      id,
      label,
      ...(own ? {to: own.to} : {}),
      ...(own?.external ? {external: true} : {}),
      groups,
    },
    tagged: own?.tagFilterRemoved === true,
  };
}

/**
 * The main navigation for a Storefront API `menu` result (or anything shaped like one). Total: junk anywhere in
 * the menu costs only that entry, never an exception (NFR-013). Ids are positions, so they are unique and the
 * same on the server and in the browser whatever the menu holds.
 */
export function buildMainNav(
  menu: unknown,
  options: MenuLinkOptions = {},
): MenuBuildResult {
  const context: Context = {
    options,
    seen: new WeakMap(),
    dropped: 0,
    tagLinksUnfiltered: 0,
  };
  const top =
    typeof menu === 'object' &&
    menu !== null &&
    'items' in menu &&
    Array.isArray(menu.items)
      ? menu.items
      : [];

  const items: MainNavItem[] = [];
  for (const value of top) {
    if (items.length >= MAX_TOP_ITEMS) {
      context.dropped += 1;
      continue;
    }
    const built = buildTopItem(value, items.length, context);
    if (!built) continue;
    const {item} = built;
    const duplicate = items.some(
      (existing) =>
        existing.label.toLowerCase() === item.label.toLowerCase() &&
        existing.to === item.to,
    );
    if (duplicate) {
      context.dropped += 1;
      continue;
    }
    if (built.tagged) context.tagLinksUnfiltered += 1;
    items.push(item);
  }
  return {
    items,
    dropped: context.dropped,
    tagLinksUnfiltered: context.tagLinksUnfiltered,
  };
}

/**
 * What the header shows: the Shopify menu when it produced items, otherwise the fixed fallback, followed by the
 * sleep-quiz call to action unless the menu already links to the quiz.
 */
export function mainNavWithQuizCta(
  menuItems: readonly MainNavItem[] | null,
  fallback: readonly MainNavItem[],
): MainNavItem[] {
  const base = menuItems && menuItems.length > 0 ? menuItems : fallback;
  const hasQuiz = base.some((item) => item.to === SLEEP_QUIZ_LINK.to);
  return hasQuiz ? [...base] : [...base, SLEEP_QUIZ_LINK];
}
