// Display helpers for cart lines. Line attributes ("properties") are shown to the shopper except those
// whose key starts with an underscore, the Shopify convention for hidden properties; the offer engine and
// the Extend link attributes use that convention so they never clutter the cart.

import {cleanText} from '~/lib/catalog/text';

export type LineProperty = {readonly label: string; readonly value: string};

type AttributeSource = {readonly key: string; readonly value?: string | null};

const MAX_PROPERTIES = 10;

export function visibleLineProperties(
  attributes: readonly AttributeSource[] | null | undefined,
): LineProperty[] {
  const properties: LineProperty[] = [];
  for (const attribute of attributes ?? []) {
    if (attribute.key.startsWith('_')) continue;
    const label = cleanText(attribute.key).slice(0, 60);
    const value = cleanText(attribute.value ?? '').slice(0, 200);
    if (label !== '' && value !== '') properties.push({label, value});
  }
  return properties.slice(0, MAX_PROPERTIES);
}

/** Options that carry information: a lone "Default Title" option says nothing and is hidden. */
export function visibleOptions<T extends {name: string; value: string}>(
  options: readonly T[],
): T[] {
  return options.filter(
    (option) => !(option.name === 'Title' && option.value === 'Default Title'),
  );
}
