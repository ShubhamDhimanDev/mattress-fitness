import {useEffect, useState} from 'react';
import {useRouteLoaderData} from 'react-router';
import {variantIdsInCart} from '~/lib/offers-runtime/product-addons';

function cartOf(rootData: unknown): unknown {
  return typeof rootData === 'object' && rootData !== null
    ? Reflect.get(rootData, 'cart')
    : undefined;
}

/**
 * The variant ids the cart holds right now, or null while that is not known (no root data, an unreadable cart, or the
 * first read still pending). Taken from the root loader's cart, which React Router reloads after every cart action
 * and every page load, so it follows a line removed in the drawer or on the cart page as well as an add. The previous
 * answer is kept while a newer cart resolves, so the row does not flicker between "added" and "add".
 */
export function useCartVariantIds(): ReadonlySet<string> | null {
  const cart = cartOf(useRouteLoaderData('root'));
  const [ids, setIds] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (cart === undefined) return;
    let active = true;
    void Promise.resolve(cart).then(
      (value) => {
        if (active) setIds(variantIdsInCart(value));
      },
      () => {
        if (active) setIds(null);
      },
    );
    return () => {
      active = false;
    };
  }, [cart]);
  return ids;
}
