import {
  data as routeData,
  Link,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from 'react-router';
import type {Route} from './+types/account.orders._index';
import {useRef} from 'react';
import {Money} from '~/components/Money';
import {OrderStatusChip} from '~/components/orders/OrderStatusChip';
import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {Input} from '~/components/ui/Input';
import {flattenConnection} from '@shopify/hydrogen';
import {
  buildOrderSearchQuery,
  parseOrderFilters,
  ORDER_FILTER_FIELDS,
  type OrderFilterParams,
} from '~/lib/orderFilters';
import {CUSTOMER_ORDERS_QUERY} from '~/graphql/customer-account/CustomerOrdersQuery';
import type {
  CustomerOrdersFragment,
  OrderItemFragment,
} from 'customer-accountapi.generated';
import {PaginatedResourceSection} from '~/components/PaginatedResourceSection';
import {
  accountFailure,
  accountNoStoreHeaders,
  requireAccountSession,
  withAccountNoStoreIfResponse,
} from '~/lib/account/results';
import {errorFields, logError} from '~/lib/logging/logger';
import {cursorPaginationVariables} from '~/lib/pages/cursor-pagination';

type OrdersLoaderData = {
  customer: CustomerOrdersFragment;
  filters: OrderFilterParams;
};

export const meta: Route.MetaFunction = () => {
  return [{title: 'Orders'}];
};

export async function loader({request, context}: Route.LoaderArgs) {
  const {customerAccount} = context;
  // Explicit, so the check does not depend on the query call making it (T-11). Which orders come back is
  // decided by Shopify from the signed-in customer's token; nothing in the URL names a customer.
  await requireAccountSession(customerAccount);

  // The cursor and direction are checked before they reach the query (security M3).
  const paginationVariables = cursorPaginationVariables(
    new URL(request.url).searchParams,
    20,
  );

  const url = new URL(request.url);
  const filters = parseOrderFilters(url.searchParams);
  const query = buildOrderSearchQuery(filters);

  let result;
  try {
    result = await customerAccount.query(CUSTOMER_ORDERS_QUERY, {
      variables: {
        ...paginationVariables,
        query,
        language: customerAccount.i18n.language,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Response) throw withAccountNoStoreIfResponse(error);
    logError('account.orders_read_failed', errorFields(error));
    throw routeData(accountFailure('failed'), {
      status: 500,
      headers: accountNoStoreHeaders(),
    });
  }

  const {data, errors} = result;
  if (errors?.length || !data?.customer) {
    logError('account.orders_read_failed', {
      reason: errors?.length ? 'graphql_errors' : 'no_customer',
    });
    throw routeData(accountFailure('failed'), {
      status: 500,
      headers: accountNoStoreHeaders(),
    });
  }

  return {customer: data.customer, filters};
}

export default function Orders() {
  const {customer, filters} = useLoaderData<OrdersLoaderData>();
  const {orders} = customer;

  return (
    <div className="orders flex flex-col gap-6">
      <h2 className="type-display text-2xl md:text-3xl">Orders</h2>
      <OrderSearchForm currentFilters={filters} />
      <OrdersTable orders={orders} filters={filters} />
    </div>
  );
}

function OrdersTable({
  orders,
  filters,
}: {
  orders: CustomerOrdersFragment['orders'];
  filters: OrderFilterParams;
}) {
  const hasFilters = !!(filters.name || filters.confirmationNumber);

  return (
    <div className="acccount-orders" aria-live="polite">
      {orders?.nodes.length ? (
        <PaginatedResourceSection
          connection={orders}
          resourcesClassName="flex flex-col gap-4 py-4"
        >
          {({node: order}) => <OrderItem key={order.id} order={order} />}
        </PaginatedResourceSection>
      ) : (
        <EmptyOrders hasFilters={hasFilters} />
      )}
    </div>
  );
}

function EmptyOrders({hasFilters = false}: {hasFilters?: boolean}) {
  return (
    <Card variant="tinted" className="flex flex-col items-start gap-4">
      {hasFilters ? (
        <>
          <p className="text-lead">No orders found matching your search.</p>
          <Button to="/account/orders" variant="outline">
            Clear filters
          </Button>
        </>
      ) : (
        <>
          <p className="text-lead">You haven&apos;t placed any orders yet.</p>
          <Button to="/collections">Start shopping</Button>
        </>
      )}
    </Card>
  );
}

function OrderSearchForm({
  currentFilters,
}: {
  currentFilters: OrderFilterParams;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isSearching =
    navigation.state !== 'idle' &&
    navigation.location?.pathname?.includes('orders');
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams();

    const name = formData.get(ORDER_FILTER_FIELDS.NAME)?.toString().trim();
    const confirmationNumber = formData
      .get(ORDER_FILTER_FIELDS.CONFIRMATION_NUMBER)
      ?.toString()
      .trim();

    if (name) params.set(ORDER_FILTER_FIELDS.NAME, name);
    if (confirmationNumber)
      params.set(ORDER_FILTER_FIELDS.CONFIRMATION_NUMBER, confirmationNumber);

    setSearchParams(params);
  };

  const hasFilters = currentFilters.name || currentFilters.confirmationNumber;

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="order-search-form"
      aria-label="Search orders"
    >
      <Card variant="tinted">
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-lg font-extrabold">Filter orders</legend>

          <div className="grid gap-4 md:grid-cols-2">
            <Input
              type="search"
              name={ORDER_FILTER_FIELDS.NAME}
              label="Order number"
              placeholder="Order #"
              defaultValue={currentFilters.name || ''}
            />
            <Input
              type="search"
              name={ORDER_FILTER_FIELDS.CONFIRMATION_NUMBER}
              label="Confirmation number"
              placeholder="Confirmation #"
              defaultValue={currentFilters.confirmationNumber || ''}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={isSearching}>
              {isSearching ? 'Searching' : 'Search'}
            </Button>
            {hasFilters && (
              <Button
                type="button"
                variant="outline"
                disabled={isSearching}
                onClick={() => {
                  setSearchParams(new URLSearchParams());
                  formRef.current?.reset();
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </fieldset>
      </Card>
    </form>
  );
}

function OrderItem({order}: {order: OrderItemFragment}) {
  const fulfillmentStatus = flattenConnection(order.fulfillments)[0]?.status;
  const href = `/account/orders/${btoa(order.id)}`;
  return (
    <Card
      as="article"
      aria-label={`Order ${order.number}`}
      className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
    >
      <div className="flex flex-col gap-1">
        <Link to={href} className="type-display text-title hover:underline">
          #{order.number}
        </Link>
        <p className="text-sm text-fg-muted">
          {new Date(order.processedAt).toDateString()}
        </p>
        {order.confirmationNumber && (
          <p className="text-sm text-fg-muted">
            Confirmation: {order.confirmationNumber}
          </p>
        )}
        <div className="mt-1 flex flex-wrap gap-2">
          {order.financialStatus && (
            <OrderStatusChip status={order.financialStatus} />
          )}
          {fulfillmentStatus && <OrderStatusChip status={fulfillmentStatus} />}
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 md:flex-col md:items-end">
        <p className="text-xl font-extrabold">
          <Money data={order.totalPrice} />
        </p>
        <Button to={href} variant="outline" size="sm">
          View order
        </Button>
      </div>
    </Card>
  );
}
