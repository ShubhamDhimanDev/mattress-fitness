// Cart attribute writes for the pre-checkout steps (P4-10, REQ-PRE-005). Whether `cartAttributesUpdate` replaces
// or merges the attribute list is unverified (attributes.ts), so the server always sends the complete list:
// the cart's existing attributes with one key replaced. That is correct under either behaviour.

import type {CartAttributeInput} from '~/lib/offers/attributes';

const MAX_ATTRIBUTES = 250;

type ExistingAttribute = {
  readonly key: string;
  readonly value?: string | null;
};

export function withAttribute(
  existing: readonly ExistingAttribute[] | null | undefined,
  next: CartAttributeInput,
): CartAttributeInput[] {
  const kept: CartAttributeInput[] = [];
  for (const attribute of existing ?? []) {
    if (attribute.key === next.key) continue;
    if (typeof attribute.value === 'string') {
      kept.push({key: attribute.key, value: attribute.value});
    }
  }
  // The offer attribute is last so it survives the cap if a hostile cart is already full.
  return [...kept.slice(0, MAX_ATTRIBUTES - 1), next];
}
