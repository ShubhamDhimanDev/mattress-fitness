// Type declarations for the Extend MOCK (scripts/mocks/extend-mock.mjs) so the Vitest integration tests that
// import it are type-checked. The mock is a test double, not Extend.

// Type-only import: the mock stores exactly what the storefront's order sync sends.
import type { ExtendOrderSnapshot } from "../../storefront/app/lib/extend/orders";

export type MockFixtures = {
  currency: string;
  categories: Record<
    string,
    {
      contractCategory: string;
      bands: Array<{
        minPriceCents: number;
        maxPriceCents: number;
        recommended: "adh" | "base";
        adh: MockFixturePlan[];
        base: MockFixturePlan[];
      }>;
    }
  >;
};

export type MockFixturePlan = {
  id: string;
  price: number;
  title: string;
  termLength: number;
};

export type MockContract = {
  contractId: string;
  lineItemTransactionId: string;
  planId: string;
  status: "active" | "cancelled" | "refunded";
  coveredProducts: Array<{
    lineItemTransactionId: string;
    productId: string;
    quantity: number;
  }>;
};

export type MockEvent = {
  type:
    | "order_created"
    | "order_updated"
    | "contract_created"
    | "contract_updated"
    | "contract_cancelled"
    | "contract_refunded";
  transactionId: string;
  lineItemTransactionId?: string;
  contractId?: string;
};

export type MockRequestRecord = {
  method: string | undefined;
  path: string;
  status: number;
  noop: boolean;
};

export type MockStoredOrder = {
  snapshot: ExtendOrderSnapshot;
  contracts: Array<{ lineItemTransactionId: string; contractId: string }>;
};

export type MockState = {
  requests: MockRequestRecord[];
  events: MockEvent[];
  orders: Map<string, unknown>;
  storedOrders: () => MockStoredOrder[];
  contracts: (transactionId: string) => MockContract[];
  eventTypes: () => Array<MockEvent["type"]>;
};

export type MockFault = {
  path?: "/offers" | "/orders" | "*";
  status?: number;
  delayMs?: number;
  body?: string;
  remaining?: number;
};

export type ExtendMock = {
  url: string;
  port: number;
  state: MockState;
  setFault: (spec: MockFault) => void;
  clearFault: () => void;
  close: () => Promise<void>;
};

export function loadDefaultFixtures(): MockFixtures;

export function startMock(options: {
  port?: number;
  host?: string;
  accessToken: string;
  storeId: string;
  fixtures?: MockFixtures;
}): Promise<ExtendMock>;
