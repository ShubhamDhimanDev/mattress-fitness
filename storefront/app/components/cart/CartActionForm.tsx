import {CartForm} from '@shopify/hydrogen';
import type {ComponentProps, ReactNode} from 'react';
import type {FetcherWithComponents} from 'react-router';
import {useReportCartResult} from '~/components/cart/cart-results';

type CartFormProps = ComponentProps<typeof CartForm>;
type Children = CartFormProps['children'];

/**
 * `CartForm` that also hands the server's answer to `CartMessages` (B-20). Use it for every form that posts to `/cart`:
 * the answer lives on this form's own fetcher, and React Router does not list a finished fetcher that is still mounted
 * in `useFetchers()`, so nothing else on the page can see it (see cart-results.ts).
 */
export function CartActionForm({children, ...props}: CartFormProps) {
  return (
    <CartForm {...props}>
      {(fetcher) => <ReportingBody fetcher={fetcher}>{children}</ReportingBody>}
    </CartForm>
  );
}

function ReportingBody({
  fetcher,
  children,
}: {
  fetcher: FetcherWithComponents<unknown>;
  children: Children;
}): ReactNode {
  useReportCartResult(fetcher.data);
  return typeof children === 'function' ? children(fetcher) : children;
}
