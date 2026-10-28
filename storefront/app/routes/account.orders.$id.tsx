import {Link, data as routeData, redirect, useLoaderData} from 'react-router';
import type {Route} from './+types/account.orders.$id';
import {Money} from '~/components/Money';
import {OrderStatusChip} from '~/components/orders/OrderStatusChip';
import {buttonStyles} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {Image} from '~/lib/hydrogen/image';
import type {
  OrderLineItemFullFragment,
  OrderQuery,
} from 'customer-accountapi.generated';
import {CUSTOMER_ORDER_QUERY} from '~/graphql/customer-account/CustomerOrderQuery';
import {
  accountFailure,
  accountNoStoreHeaders,
  decodeOrderRouteId,
  requireAccountSession,
  withAccountNoStoreIfResponse,
} from '~/lib/account/results';
import {errorFields, logError} from '~/lib/logging/logger';

function notFound() {
  return routeData(
    {status: 'error', message: 'We could not find that order.'},
    {status: 404, headers: accountNoStoreHeaders()},
  );
}

export const meta: Route.MetaFunction = ({data}) => {
  return [{title: `Order ${data?.order?.name}`}];
};

export async function loader({params, context}: Route.LoaderArgs) {
  const {customerAccount} = context;
  await requireAccountSession(customerAccount);

  if (!params.id) {
    return redirect('/account/orders', {headers: accountNoStoreHeaders()});
  }

  // The same answer for a malformed id, an order that does not exist and an order that belongs to someone
  // else: Shopify returns no order for a token that does not own it, and this route never says which case
  // it was (T-11).
  const orderId = decodeOrderRouteId(params.id);
  if (orderId === null) throw notFound();

  let result: {data: OrderQuery | null | undefined; errors?: unknown[]};
  try {
    result = await customerAccount.query(CUSTOMER_ORDER_QUERY, {
      variables: {
        orderId,
        language: customerAccount.i18n.language,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Response) throw withAccountNoStoreIfResponse(error);
    logError('account.order_read_failed', errorFields(error));
    throw routeData(accountFailure('failed'), {
      status: 500,
      headers: accountNoStoreHeaders(),
    });
  }

  const {data, errors} = result;
  if (!data?.order) {
    // A read that failed is not a missing order: only the absence of an order without errors is a 404.
    if (errors?.length) {
      logError('account.order_read_failed', {reason: 'graphql_errors'});
      throw routeData(accountFailure('failed'), {
        status: 500,
        headers: accountNoStoreHeaders(),
      });
    }
    throw notFound();
  }

  const {order} = data;

  // Extract line items directly from nodes array
  const lineItems = order.lineItems.nodes;

  // Extract discount applications directly from nodes array
  const discountApplications = order.discountApplications.nodes;

  // Get fulfillment status from first fulfillment node
  const fulfillmentStatus = order.fulfillments.nodes[0]?.status ?? 'N/A';

  // Get first discount value with proper type checking
  const firstDiscount = discountApplications[0]?.value;

  // Type guard for MoneyV2 discount
  const discountValue =
    firstDiscount?.__typename === 'MoneyV2'
      ? (firstDiscount as Extract<
          typeof firstDiscount,
          {__typename: 'MoneyV2'}
        >)
      : null;

  // Type guard for percentage discount
  const discountPercentage =
    firstDiscount?.__typename === 'PricingPercentageValue'
      ? (
          firstDiscount as Extract<
            typeof firstDiscount,
            {__typename: 'PricingPercentageValue'}
          >
        ).percentage
      : null;

  return {
    order,
    lineItems,
    discountValue,
    discountPercentage,
    fulfillmentStatus,
  };
}

export default function OrderRoute() {
  const {
    order,
    lineItems,
    discountValue,
    discountPercentage,
    fulfillmentStatus,
  } = useLoaderData<typeof loader>();
  return (
    <div className="account-order flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          to="/account/orders"
          className="inline-flex min-h-touch w-fit items-center font-bold text-primary-700 underline underline-offset-2"
        >
          Back to all orders
        </Link>
        <h2 className="type-display text-2xl md:text-3xl">
          Order {order.name}
        </h2>
        {order.processedAt ? (
          <p className="text-fg-muted">
            Placed on {new Date(order.processedAt).toDateString()}
          </p>
        ) : null}
        {order.confirmationNumber && (
          <p className="text-fg-muted">
            Confirmation: {order.confirmationNumber}
          </p>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card padding="none" className="overflow-hidden">
          <div>
            <table className="w-full border-collapse text-left">
              <thead className="bg-paper text-xs sm:text-sm">
                <tr>
                  <th scope="col" className="px-2 py-3 font-extrabold sm:px-4">
                    Product
                  </th>
                  <th scope="col" className="px-2 py-3 font-extrabold sm:px-4">
                    Price
                  </th>
                  <th scope="col" className="px-2 py-3 font-extrabold sm:px-4">
                    Quantity
                  </th>
                  <th scope="col" className="px-2 py-3 font-extrabold sm:px-4">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lineItems.map((lineItem, lineItemIndex) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <OrderLineRow key={lineItemIndex} lineItem={lineItem} />
                ))}
              </tbody>
              <tfoot className="border-t border-line bg-paper">
                {((discountValue && discountValue.amount) ||
                  discountPercentage) && (
                  <tr>
                    <th scope="row" colSpan={3} className="px-2 py-2 sm:px-4">
                      Discounts
                    </th>
                    <td className="px-2 py-2 sm:px-4">
                      {discountPercentage ? (
                        <span>-{discountPercentage}% OFF</span>
                      ) : (
                        <Money data={discountValue} />
                      )}
                    </td>
                  </tr>
                )}
                <tr>
                  <th scope="row" colSpan={3} className="px-2 py-2 sm:px-4">
                    Subtotal
                  </th>
                  <td className="px-2 py-2 sm:px-4">
                    <Money data={order.subtotal} />
                  </td>
                </tr>
                <tr>
                  <th scope="row" colSpan={3} className="px-2 py-2 sm:px-4">
                    Tax
                  </th>
                  <td className="px-2 py-2 sm:px-4">
                    <Money data={order.totalTax} />
                  </td>
                </tr>
                <tr className="text-lg font-extrabold">
                  <th scope="row" colSpan={3} className="px-2 py-3 sm:px-4">
                    Total
                  </th>
                  <td className="px-2 py-3 sm:px-4">
                    <Money data={order.totalPrice} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
        <div className="flex flex-col gap-6">
          <Card as="section" aria-labelledby="order-shipping-heading">
            <h3
              id="order-shipping-heading"
              className="type-display mb-3 text-title"
            >
              Shipping address
            </h3>
            {order?.shippingAddress ? (
              <address className="flex flex-col gap-1 not-italic">
                <p className="font-bold">{order.shippingAddress.name}</p>
                {order.shippingAddress.formatted ? (
                  <p>{order.shippingAddress.formatted}</p>
                ) : (
                  ''
                )}
                {order.shippingAddress.formattedArea ? (
                  <p>{order.shippingAddress.formattedArea}</p>
                ) : (
                  ''
                )}
              </address>
            ) : (
              <p>No shipping address defined</p>
            )}
          </Card>
          <Card as="section" aria-labelledby="order-status-heading">
            <h3
              id="order-status-heading"
              className="type-display mb-3 text-title"
            >
              Status
            </h3>
            {fulfillmentStatus === 'N/A' ? (
              <p>{fulfillmentStatus}</p>
            ) : (
              <OrderStatusChip status={fulfillmentStatus} />
            )}
          </Card>
        </div>
      </div>
      <p>
        <a
          target="_blank"
          href={order.statusPageUrl}
          rel="noreferrer"
          className={buttonStyles({variant: 'outline'})}
        >
          View order status
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    </div>
  );
}

function OrderLineRow({lineItem}: {lineItem: OrderLineItemFullFragment}) {
  return (
    <tr key={lineItem.id}>
      <td className="px-2 py-3 sm:px-4">
        <div className="flex items-center gap-3">
          {lineItem?.image && (
            <div className="hidden size-16 shrink-0 overflow-hidden rounded-choice bg-paper sm:block">
              <Image data={lineItem.image} width={96} height={96} />
            </div>
          )}
          <div>
            <p className="font-bold">{lineItem.title}</p>
            <small className="text-fg-muted">{lineItem.variantTitle}</small>
          </div>
        </div>
      </td>
      <td className="px-2 py-3 sm:px-4">
        <Money data={lineItem.price} />
      </td>
      <td className="px-2 py-3 sm:px-4">{lineItem.quantity}</td>
      <td className="px-2 py-3 sm:px-4">
        {/* The line total after its own discounts, from Shopify (unit price x quantity, less line discounts). */}
        <Money data={lineItem.totalPriceWithDiscounts} />
      </td>
    </tr>
  );
}
