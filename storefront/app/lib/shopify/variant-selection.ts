// Variant selection from URL state (`?Size=Queen`), REQ-PDP-001. Pure and shared by the loader (server
// render) and the page (instant switching), so both always agree. Every value from the URL is checked
// against the product's own options: unknown names and values are dropped (threat T-07).

import {toSlug} from '~/lib/catalog/attributes';
import type {
  OptionView,
  SelectedOptionView,
  VariantView,
} from '~/lib/shopify/types';

const MAX_PARAM_LENGTH = 100;

function sameText(a: string, b: string): boolean {
  return toSlug(a) === toSlug(b);
}

/**
 * Options named in the URL, matched case- and punctuation-insensitively to the product's options, one
 * value per option, in the product's option order. Unknown names or values are ignored.
 */
export function parseSelectedOptions(
  params: URLSearchParams,
  options: readonly OptionView[],
): SelectedOptionView[] {
  const selected: SelectedOptionView[] = [];
  for (const option of options) {
    for (const [name, raw] of params.entries()) {
      if (raw.length > MAX_PARAM_LENGTH || !sameText(name, option.name))
        continue;
      const value = option.values.find((candidate) => sameText(candidate, raw));
      if (value !== undefined) {
        selected.push({name: option.name, value});
        break;
      }
    }
  }
  return selected;
}

function matches(
  variant: VariantView,
  selected: readonly SelectedOptionView[],
): boolean {
  return selected.every((wanted) =>
    variant.selectedOptions.some(
      (option) => option.name === wanted.name && option.value === wanted.value,
    ),
  );
}

function preferAvailable(
  candidates: readonly VariantView[],
): VariantView | null {
  return (
    candidates.find((variant) => variant.available) ?? candidates[0] ?? null
  );
}

/**
 * The variant for a selection. Earlier options (Size comes first) win over later ones: when the exact
 * combination does not exist, the later options are dropped one at a time. With no selection the first
 * buyable variant is chosen, the same default Shopify uses.
 */
export function selectVariant(
  variants: readonly VariantView[],
  selected: readonly SelectedOptionView[],
): VariantView | null {
  for (let keep = selected.length; keep > 0; keep -= 1) {
    const found = preferAvailable(
      variants.filter((variant) => matches(variant, selected.slice(0, keep))),
    );
    if (found) return found;
  }
  return preferAvailable(variants);
}

/** The option values of a variant, in the product's option order, for the URL and the selectors. */
export function selectionOf(
  variant: VariantView,
  options: readonly OptionView[],
): SelectedOptionView[] {
  return options.flatMap((option) => {
    const chosen = variant.selectedOptions.find(
      (candidate) => candidate.name === option.name,
    );
    return chosen ? [{name: option.name, value: chosen.value}] : [];
  });
}

/**
 * Whether choosing `value` for `optionName` leads to a buyable variant, given the choices made for the
 * options before it. Later options are free, so a size is only "sold out" when no colour of it is left.
 */
export function isOptionValueAvailable(
  variants: readonly VariantView[],
  options: readonly OptionView[],
  selected: readonly SelectedOptionView[],
  optionName: string,
  value: string,
): boolean {
  const position = options.findIndex((option) => option.name === optionName);
  const earlier = selected.filter(
    (choice) =>
      options.findIndex((option) => option.name === choice.name) < position,
  );
  return variants.some(
    (variant) =>
      variant.available &&
      matches(variant, [...earlier, {name: optionName, value}]),
  );
}

/** Query string for a selection: `Size=Queen&Color=Sand`. */
export function selectionToSearch(
  selected: readonly SelectedOptionView[],
): string {
  const params = new URLSearchParams();
  for (const choice of selected) params.set(choice.name, choice.value);
  return params.toString();
}

/** Dimensions text for an option value, from the first variant that has it, for the size selector. */
export function dimensionsForValue(
  variants: readonly VariantView[],
  optionName: string,
  value: string,
): string | null {
  for (const variant of variants) {
    const has = variant.selectedOptions.some(
      (option) => option.name === optionName && option.value === value,
    );
    if (has && variant.dimensions) return variant.dimensions;
  }
  return null;
}
