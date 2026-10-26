// `CartForm` and `useOptimisticCart` for the cart UI. Ported from @shopify/hydrogen 2026.4.7 (MIT); the 2026.10 library
// replaced them with a client cart store (`createCartComponents`), which this project does not use because its cart
// routes validate and repair every mutation on the server (ADR-0003, ADR-0012). The form still posts one JSON field
// (`cartFormInput`) to the cart route; `getFormInput` reads it back on the server.

import {
  useFetcher,
  useFetchers,
  type FetcherWithComponents,
} from 'react-router';
import type {ReactNode} from 'react';

const INPUT_NAME = 'cartFormInput';

const ACTIONS = {
  AttributesUpdateInput: 'AttributesUpdateInput',
  BuyerIdentityUpdate: 'BuyerIdentityUpdate',
  Create: 'Create',
  DiscountCodesUpdate: 'DiscountCodesUpdate',
  GiftCardCodesUpdate: 'GiftCardCodesUpdate',
  GiftCardCodesAdd: 'GiftCardCodesAdd',
  GiftCardCodesRemove: 'GiftCardCodesRemove',
  LinesAdd: 'LinesAdd',
  LinesRemove: 'LinesRemove',
  LinesUpdate: 'LinesUpdate',
  NoteUpdate: 'NoteUpdate',
  SelectedDeliveryOptionsUpdate: 'SelectedDeliveryOptionsUpdate',
  MetafieldsSet: 'MetafieldsSet',
  MetafieldDelete: 'MetafieldDelete',
} as const;

type FormValues = {[key: string]: unknown};

export type OptimisticCartLineInput = {
  merchandiseId: string;
  quantity?: number;
  attributes?: Array<{key: string; value: string}>;
  sellingPlanId?: string;
  /** The variant as the page holds it, so the line can show before the server answers. */
  selectedVariant?: unknown;
};

export type CartActionInput = {
  /** A built-in action or a project action name (app/lib/cart/custom-actions.ts). */
  action: string;
  inputs?: FormValues;
};

type CartFormProps = {
  children:
    ReactNode | ((fetcher: FetcherWithComponents<unknown>) => ReactNode);
  route?: string;
  fetcherKey?: string;
} & Partial<CartActionInput>;

export function CartForm({
  children,
  action,
  inputs,
  route,
  fetcherKey,
}: CartFormProps) {
  const fetcher = useFetcher({key: fetcherKey});
  return (
    <fetcher.Form action={route || ''} method="post">
      {(action || inputs) && (
        <input
          type="hidden"
          name={INPUT_NAME}
          value={JSON.stringify({action, inputs})}
        />
      )}
      {typeof children === 'function' ? children(fetcher) : children}
    </fetcher.Form>
  );
}

CartForm.INPUT_NAME = INPUT_NAME;
CartForm.ACTIONS = ACTIONS;

/** Reads the posted form back: the JSON input first, then the other fields (a repeated field becomes a list). */
CartForm.getFormInput = (
  formData: FormData,
): {action: string; inputs: FormValues} => {
  const data: FormValues = {};
  for (const [key, first] of formData.entries()) {
    const values = formData.getAll(key);
    const value: unknown = values.length > 1 ? values : first;
    data[key] = value === 'on' ? true : value === 'off' ? false : value;
  }
  const {[INPUT_NAME]: cartFormInput, ...otherData} = data;
  const parsed: unknown = cartFormInput
    ? JSON.parse(String(cartFormInput))
    : {};
  const {action, inputs} = (parsed ?? {}) as {
    action?: string;
    inputs?: FormValues;
  };
  return {action: action ?? '', inputs: {...inputs, ...otherData}};
};

// --- optimistic cart -----------------------------------------------------------------------------------------

const PENDING_PREFIX = '__h_pending_';
const isOptimisticLineId = (lineId: string) =>
  lineId.startsWith(PENDING_PREFIX);

type LineLike = {
  id: string;
  quantity: number;
  merchandise: {id: string};
};

type CartLike = {lines: {nodes: LineLike[]}; totalQuantity?: number};

export type OptimisticCartLine<T = CartLike> = (T extends {
  lines: {nodes: Array<infer Line>};
}
  ? Line
  : T) & {isOptimistic?: boolean};

type PartialDeep<T> = T extends readonly (infer Element)[]
  ? Element[]
  : T extends object
    ? {[Key in keyof T]?: PartialDeep<T[Key]>}
    : T;

/**
 * The cart with in-flight changes applied. When the cart may still be null (none created yet) every other field is
 * optional, because an empty optimistic cart has only lines.
 */
export type OptimisticCart<T = CartLike | null | undefined> = (null extends T
  ? PartialDeep<Omit<NonNullable<T>, 'lines'>>
  : undefined extends T
    ? PartialDeep<Omit<NonNullable<T>, 'lines'>>
    : Omit<NonNullable<T>, 'lines'>) & {
  isOptimistic?: boolean;
  lines: {nodes: Array<OptimisticCartLine<NonNullable<T>>>};
  totalQuantity?: number;
};

/** The cart with the add, remove and quantity changes that are in flight applied, so the page answers at once. */
export function useOptimisticCart<T extends CartLike | null | undefined>(
  cart: T,
): OptimisticCart<T> {
  const fetchers = useFetchers();
  if (!fetchers.length) return cart as unknown as OptimisticCart<T>;

  const optimistic = (cart?.lines
    ? structuredClone(cart)
    : {lines: {nodes: []}}) as unknown as {
    lines: {nodes: Array<LineLike & {isOptimistic?: boolean}>};
    totalQuantity?: number;
    isOptimistic?: boolean;
  };
  const lines = optimistic.lines.nodes;
  let isOptimistic = false;

  for (const {formData} of fetchers) {
    if (!formData) continue;
    const {action, inputs} = CartForm.getFormInput(formData);
    if (action === ACTIONS.LinesAdd) {
      for (const input of (inputs.lines ?? []) as OptimisticCartLineInput[]) {
        const variant = input.selectedVariant as {id: string} | undefined;
        if (!variant) continue;
        isOptimistic = true;
        const existing = lines.find(
          (line) => line.merchandise.id === variant.id,
        );
        if (existing) {
          existing.quantity = (existing.quantity || 1) + (input.quantity || 1);
          existing.isOptimistic = true;
        } else {
          lines.unshift({
            id: PENDING_PREFIX + variant.id,
            merchandise: variant,
            isOptimistic: true,
            quantity: input.quantity || 1,
          });
        }
      }
    } else if (action === ACTIONS.LinesRemove) {
      for (const lineId of (inputs.lineIds ?? []) as string[]) {
        const index = lines.findIndex((line) => line.id === lineId);
        if (index !== -1 && !isOptimisticLineId(lines[index]?.id ?? '')) {
          lines.splice(index, 1);
          isOptimistic = true;
        }
      }
    } else if (action === ACTIONS.LinesUpdate) {
      for (const update of (inputs.lines ?? []) as Array<{
        id: string;
        quantity: number;
      }>) {
        const index = lines.findIndex((line) => line.id === update.id);
        const line = lines[index];
        if (!line || isOptimisticLineId(line.id)) continue;
        line.quantity = update.quantity;
        if (line.quantity === 0) lines.splice(index, 1);
        isOptimistic = true;
      }
    }
  }

  if (isOptimistic) optimistic.isOptimistic = true;
  optimistic.totalQuantity = lines.reduce(
    (sum, line) => sum + line.quantity,
    0,
  );
  return optimistic as unknown as OptimisticCart<T>;
}
