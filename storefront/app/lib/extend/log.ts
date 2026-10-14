// Structured log events for the Extend integration (T-05: no personal data in logs).
// The event shape is a closed allow-list: there is deliberately no field that could carry a name, email,
// address, phone number, token or full payload, and TypeScript rejects extra properties at call sites.

export type ExtendLogEventName =
  | 'offers.request_failed'
  | 'offers.circuit_open'
  | 'offers.response_dropped_items'
  | 'sync.skipped'
  | 'sync.coverage_flagged'
  | 'sync.coverage_warning'
  | 'sync.quote_lookup_failed'
  | 'sync.attempt_failed'
  | 'sync.succeeded'
  | 'sync.gave_up'
  | 'webhook.rejected'
  | 'webhook.ignored'
  | 'webhook.accepted'
  | 'webhook.coalesced'
  | 'webhook.order_read_failed'
  | 'webhook.background_failed'
  | 'offers.route_rejected'
  | 'offers.route_unavailable'
  | 'coverage.catalog_unavailable'
  | 'coverage.catalog_incomplete'
  | 'coverage.inputs_degraded';

export type ExtendLogEvent = {
  level: 'info' | 'warn' | 'error';
  event: ExtendLogEventName;
  orderId?: string;
  lineIds?: readonly string[];
  planIds?: readonly string[];
  reason?: string;
  httpStatus?: number;
  attempt?: number;
  count?: number;
};

export type ExtendLogger = (event: ExtendLogEvent) => void;

export const noopLogger: ExtendLogger = () => {};
