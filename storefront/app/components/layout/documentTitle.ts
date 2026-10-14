import {SITE_NAME} from '~/lib/navigation';

const SEPARATOR = ' | ';

/**
 * Document title pattern: "Page title | Site name". The home page passes no title and gets the site name
 * with a short descriptor. Route `meta` functions call this so every title ends the same way.
 */
export function formatPageTitle(title?: string | null): string {
  const clean = title?.trim();
  if (!clean) return `${SITE_NAME}${SEPARATOR}Mattresses, bases and bedding`;
  if (clean === SITE_NAME) return SITE_NAME;
  return `${clean}${SEPARATOR}${SITE_NAME}`;
}
