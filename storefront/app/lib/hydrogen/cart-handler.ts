// The server-side cart handler the cart routes use (`context.cart`, ADR-0012). Hydrogen 2026.10 replaced
// `createCartHandler` with `createCartServerHandlers` (a `/api/cart` endpoint plus a client cart store). This project's
// cart routes validate every input, run the offer engine after each mutation and hand the shopper to the pre-checkout
// steps (ADR-0003), so they keep one route action and call these methods directly. The operations, the cookie and the
// result shape are ported from @shopify/hydrogen 2026.4.7 (MIT) so the callers did not change.
//
// Why the documents are built here and not written as `#graphql` strings: the codegen scans app/ for `#graphql`
// documents, and these take their selection from the caller. Their results are typed by the cart fragment's generated
// type, as before.

import type {CartApiQueryFragment} from 'storefrontapi.generated';
import type {Storefront, StorefrontApiErrors} from './storefront';

const COOKIE_NAME = 'cart';
const GID_PREFIX = 'gid://shopify/Cart/';

export type CookieOptions = {
  path?: string;
  maxage?: number;
  httponly?: boolean;
  secure?: boolean;
  samesite?: 'Lax' | 'Strict' | 'None';
};

/** `cart=<id without the gid prefix>` with the given flags; the id carries the cart's access key (`?key=`). */
export function cartSetIdDefault(options: CookieOptions = {}) {
  return (cartId: string): Headers => {
    const id = cartId.split('/').pop() ?? '';
    const parts = [`${COOKIE_NAME}=${encodeURIComponent(id)}`];
    parts.push(`Path=${options.path ?? '/'}`);
    if (options.maxage !== undefined) parts.push(`Max-Age=${options.maxage}`);
    if (options.httponly) parts.push('HttpOnly');
    if (options.secure) parts.push('Secure');
    if (options.samesite) parts.push(`SameSite=${options.samesite}`);
    const headers = new Headers();
    headers.append('Set-Cookie', parts.join('; '));
    return headers;
  };
}

function readCartCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0 || pair.slice(0, index).trim() !== COOKIE_NAME) continue;
    try {
      const value = decodeURIComponent(pair.slice(index + 1).trim());
      return value === '' ? undefined : `${GID_PREFIX}${value}`;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

type CartUserError = {
  message: string;
  field?: string[] | null;
  code?: string | null;
};
type CartWarning = {message: string; code: string; target: string};

/** What every mutation returns. The cart is typed as the app's cart fragment, as the old handler did; the mutation selection is smaller (id, quantity, checkout URL) and the cart routes re-read with `get`. */
export type CartMutationReturn = {
  cart?: CartApiQueryFragment | null;
  userErrors?: CartUserError[];
  warnings?: CartWarning[];
  errors?: StorefrontApiErrors;
};

type AttributeInput = {key: string; value: string};
type CartLineInput = {
  merchandiseId: string;
  quantity?: number;
  attributes?: AttributeInput[];
  sellingPlanId?: string;
  parent?: {merchandiseId: string} | {lineId: string};
};
type CartLineUpdateInput = {
  id: string;
  quantity?: number;
  merchandiseId?: string;
  attributes?: AttributeInput[];
  sellingPlanId?: string;
};
type CartInput = {
  lines?: CartLineInput[];
  discountCodes?: string[];
  attributes?: AttributeInput[];
  note?: string;
  buyerIdentity?: Record<string, unknown>;
};

export type CartHandler = {
  get: (input?: {
    cartId?: string;
  }) => Promise<(CartApiQueryFragment & {errors?: StorefrontApiErrors}) | null>;
  getCartId: () => string | undefined;
  setCartId: (cartId: string) => Headers;
  create: (input: CartInput) => Promise<CartMutationReturn>;
  addLines: (lines: CartLineInput[]) => Promise<CartMutationReturn>;
  updateLines: (lines: CartLineUpdateInput[]) => Promise<CartMutationReturn>;
  removeLines: (lineIds: string[]) => Promise<CartMutationReturn>;
  updateDiscountCodes: (codes: string[]) => Promise<CartMutationReturn>;
  updateAttributes: (
    attributes: AttributeInput[],
  ) => Promise<CartMutationReturn>;
};

const IN_CONTEXT =
  '$country: CountryCode, $language: LanguageCode) @inContext(country: $country, language: $language';

const MUTATION_FRAGMENTS = `
  fragment CartApiMutation on Cart { id totalQuantity checkoutUrl }
  fragment CartApiError on CartUserError { message field code }
  fragment CartApiWarning on CartWarning { code message target }
`;

function mutationDocument(
  name: string,
  declarations: string,
  call: string,
): string {
  return `mutation ${name}(${declarations}, ${IN_CONTEXT}) {
    ${name}(${call}) {
      cart { ...CartApiMutation }
      userErrors { ...CartApiError }
      warnings { ...CartApiWarning }
    }
  }
  ${MUTATION_FRAGMENTS}`;
}

const DOCUMENTS = {
  cartCreate: mutationDocument(
    'cartCreate',
    '$input: CartInput!',
    'input: $input',
  ),
  cartLinesAdd: mutationDocument(
    'cartLinesAdd',
    '$cartId: ID!, $lines: [CartLineInput!]!',
    'cartId: $cartId, lines: $lines',
  ),
  cartLinesUpdate: mutationDocument(
    'cartLinesUpdate',
    '$cartId: ID!, $lines: [CartLineUpdateInput!]!',
    'cartId: $cartId, lines: $lines',
  ),
  cartLinesRemove: mutationDocument(
    'cartLinesRemove',
    '$cartId: ID!, $lineIds: [ID!]!',
    'cartId: $cartId, lineIds: $lineIds',
  ),
  // The 2026.4 handler selected the cart under `@defer` here; the single JSON response does not support it, and the
  // cart routes re-read the cart afterwards anyway.
  cartDiscountCodesUpdate: mutationDocument(
    'cartDiscountCodesUpdate',
    '$cartId: ID!, $discountCodes: [String!]!',
    'cartId: $cartId, discountCodes: $discountCodes',
  ),
  cartAttributesUpdate: mutationDocument(
    'cartAttributesUpdate',
    '$cartId: ID!, $attributes: [AttributeInput!]!',
    'cartId: $cartId, attributes: $attributes',
  ),
} as const;

function cartQueryDocument(fragment: string): string {
  return `query CartQuery($cartId: ID!, $numCartLines: Int = 100, ${IN_CONTEXT}) {
    cart(id: $cartId) { ...CartApiQuery }
  }
  ${fragment}`;
}

type CartPayload = {
  cart?: CartApiQueryFragment | null;
  userErrors?: CartUserError[];
  warnings?: CartWarning[];
};

export function createCartHandler(options: {
  storefront: Storefront;
  /** The request's `Cookie` header. */
  cookieHeader: string | null;
  setCartId: (cartId: string) => Headers;
  /** The full cart selection (fragment `CartApiQuery`, which may use `$numCartLines`). */
  cartQueryFragment: string;
  /** Marks the checkout link of a signed-in shopper's cart (`logged_in=true`), as the 2026.4 handler did. */
  isLoggedIn?: () => Promise<boolean>;
}): CartHandler {
  const {storefront, setCartId, cartQueryFragment, isLoggedIn} = options;
  let cartId = readCartCookie(options.cookieHeader);
  const getCartId = () => cartId;
  const queryDocument = cartQueryDocument(cartQueryFragment);

  // The query and mutation methods are typed by the generated map; these documents are built at runtime, so the call
  // goes through the untyped signature and the payload is typed by `CartPayload`.
  type Untyped = (
    document: string,
    options?: {
      variables?: Record<string, unknown>;
      cache?: ReturnType<Storefront['CacheNone']>;
    },
  ) => Promise<Record<string, unknown> & {errors?: StorefrontApiErrors}>;
  const query = storefront.query as unknown as Untyped;
  const mutate = storefront.mutate as unknown as Untyped;

  async function run(
    name: keyof typeof DOCUMENTS,
    variables: Record<string, unknown>,
  ): Promise<CartMutationReturn> {
    const result = await mutate(DOCUMENTS[name], {variables});
    const payload = result[name] as CartPayload | null | undefined;
    return {...payload, ...(result.errors ? {errors: result.errors} : {})};
  }

  async function create(input: CartInput): Promise<CartMutationReturn> {
    const result = await run('cartCreate', {input});
    cartId = result.cart?.id ?? undefined;
    return result;
  }

  // With no cart yet, the first change creates one, as the 2026.4 handler did.
  const orCreate = (
    input: CartInput,
    change: (id: string) => Promise<CartMutationReturn>,
  ): Promise<CartMutationReturn> => (cartId ? change(cartId) : create(input));

  return {
    async get(input) {
      const id = input?.cartId ?? cartId;
      if (!id) return null;
      const [loggedIn, result] = await Promise.all([
        isLoggedIn ? isLoggedIn() : Promise.resolve(false),
        query(queryDocument, {
          variables: {cartId: id},
          cache: storefront.CacheNone(),
        }),
      ]);
      const cart = result.cart as CartApiQueryFragment | null | undefined;
      if (cart && loggedIn && typeof cart.checkoutUrl === 'string') {
        const url = new URL(cart.checkoutUrl);
        url.searchParams.set('logged_in', 'true');
        Object.assign(cart, {checkoutUrl: url.toString()});
      }
      return cart || result.errors
        ? ({
            ...cart,
            ...(result.errors ? {errors: result.errors} : {}),
          } as CartApiQueryFragment)
        : null;
    },
    getCartId,
    setCartId,
    create,
    addLines: (lines) =>
      orCreate({lines}, (id) => run('cartLinesAdd', {cartId: id, lines})),
    updateLines: (lines) => run('cartLinesUpdate', {cartId, lines}),
    removeLines: (lineIds) => run('cartLinesRemove', {cartId, lineIds}),
    updateDiscountCodes: (codes) => {
      const discountCodes = [...new Set(codes)];
      return orCreate({discountCodes}, (id) =>
        run('cartDiscountCodesUpdate', {cartId: id, discountCodes}),
      );
    },
    updateAttributes: (attributes) =>
      orCreate({attributes}, (id) =>
        run('cartAttributesUpdate', {cartId: id, attributes}),
      ),
  };
}
