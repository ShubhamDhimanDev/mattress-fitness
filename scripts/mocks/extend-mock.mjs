#!/usr/bin/env node
/**
 * MOCK of Extend's API. This is NOT Extend and NOT evidence of how Extend behaves.
 *
 * It implements ONLY the subset documented in docs/integrations/EXTEND.md (sections 2 and 4, ADR-0009):
 *   POST /offers, GET /offers   (fixtures in scripts/mocks/fixtures/extend/offers.json)
 *   PUT  /orders                (idempotent full-snapshot upsert keyed by transactionId)
 * and the documented authentication header (X-Extend-Access-Token). Everything else the docs do not state is
 * invented here only so the storefront code can be exercised, and each such choice is listed as an
 * ASSUMPTION(V-11) in EXTEND.md to be confirmed against the Extend demo host (https://api-demo.helloextend.com).
 * A passing run against this mock proves our code does what we think the docs say, nothing more.
 *
 * Every response carries `X-Extend-Mock: true`.
 *
 * Mock-only behaviours (documented here so nobody mistakes them for Extend's):
 *   - Rejects a request without the documented Accept version header (400). Extend's behaviour is not documented.
 *   - A contract is created when a contract-bearing line's fulfilledQuantity goes from 0 to a positive number
 *     (documented). A later snapshot that omits the line cancels the contract; order status "refunded" refunds all
 *     of the order's contracts; reducing coveredProducts updates it (all of these follow the documented refund and
 *     removal semantics; the contract states themselves are invented).
 *   - Refunded is terminal: once an order is refunded the mock keeps its contracts refunded.
 *   - PUT /orders answers 200 with {"mock": true}; the real response body is not documented.
 *   - GET /__mock/orders returns the stored orders and contracts for the reconcile script. It is invented here
 *     (Extend documents no read-back) and needs the same access token.
 *   - Fault injection (setFault) and the in-memory `state` exist only for tests.
 *
 * Usage as a library:  const mock = await startMock({accessToken, storeId});  mock.url / mock.state / mock.close()
 * Usage as a CLI:      node scripts/mocks/extend-mock.mjs --port 4010
 *                      (env EXTEND_MOCK_ACCESS_TOKEN and EXTEND_MOCK_STORE_ID override the local defaults below)
 *
 * Zero dependencies; binds to 127.0.0.1 only; keeps all state in memory.
 */

import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ACCEPT_VERSION = "version=2022-02-01";
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_OFFERS_FIXTURE = new URL(
  "./fixtures/extend/offers.json",
  import.meta.url,
);
// Local defaults for the CLI only. These are values of the mock itself, not credentials for anything real.
const CLI_DEFAULT_TOKEN = "mock-access-token";
const CLI_DEFAULT_STORE_ID = "mock-store-id";

export function loadDefaultFixtures() {
  return JSON.parse(readFileSync(DEFAULT_OFFERS_FIXTURE, "utf8"));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInt(value, min = 0) {
  return Number.isSafeInteger(value) && value >= min;
}

/** Key-order-independent JSON so "same snapshot" does not depend on how the client ordered its keys. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isContractLine(line) {
  return line.type === "category_contract" || isRecord(line.plan);
}

/** Documented line shapes -> the covered products a contract line protects. */
function coveredProductsOf(line) {
  if (line.type === "category_contract") {
    return line.coveredProducts.map((item) => ({
      lineItemTransactionId: item.lineItemTransactionId,
      productId: item.productId,
      quantity: item.quantity,
    }));
  }
  // Product Protection: the plan sits on the product line itself.
  return [
    {
      lineItemTransactionId: line.lineItemTransactionId,
      productId: line.product.id,
      quantity: line.quantity,
    },
  ];
}

// ------------------------------------------------------------- validation

function validateOrderBody(body, storeId) {
  const errors = [];
  if (!isRecord(body)) return ["body must be a JSON object"];
  if (typeof body.transactionId !== "string" || body.transactionId === "") {
    errors.push("transactionId must be a non-empty string");
  }
  if (body.storeId !== storeId)
    errors.push("storeId does not match this store");
  if (typeof body.currency !== "string" || body.currency.length !== 3) {
    errors.push("currency must be a 3-letter code");
  }
  if (!isInt(body.total))
    errors.push("total must be an integer number of cents");
  if (body.customer !== undefined && !isRecord(body.customer)) {
    errors.push("customer must be an object");
  }
  if (body.status !== undefined && body.status !== "refunded") {
    errors.push('status, when present, must be "refunded"');
  }
  if (!Array.isArray(body.lineItems)) {
    errors.push("lineItems must be an array");
    return errors;
  }

  const productLines = new Map();
  const seen = new Set();
  for (const [index, line] of body.lineItems.entries()) {
    const at = `lineItems[${index}]`;
    if (!isRecord(line)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    const id = line.lineItemTransactionId;
    if (typeof id !== "string" || id === "") {
      errors.push(`${at}.lineItemTransactionId must be a non-empty string`);
    } else if (seen.has(id)) {
      errors.push(`${at}.lineItemTransactionId "${id}" is not unique`);
    } else {
      seen.add(id);
    }
    if (!isInt(line.quantity, 1))
      errors.push(`${at}.quantity must be an integer >= 1`);
    if (
      !isInt(line.fulfilledQuantity) ||
      (isInt(line.quantity) && line.fulfilledQuantity > line.quantity)
    ) {
      errors.push(
        `${at}.fulfilledQuantity must be an integer between 0 and quantity`,
      );
    }
    if (line.type !== undefined && line.type !== "category_contract") {
      errors.push(`${at}.type must be "category_contract" when present`);
    }

    if (line.type === "category_contract") {
      if (
        !isRecord(line.plan) ||
        typeof line.plan.id !== "string" ||
        !isInt(line.plan.purchasePrice)
      ) {
        errors.push(`${at}.plan needs a string id and integer purchasePrice`);
      }
      if (
        !Array.isArray(line.coveredProducts) ||
        line.coveredProducts.length === 0
      ) {
        errors.push(`${at}.coveredProducts is required for category_contract`);
      } else {
        for (const [i, item] of line.coveredProducts.entries()) {
          if (
            !isRecord(item) ||
            typeof item.lineItemTransactionId !== "string" ||
            typeof item.productId !== "string" ||
            !isInt(item.quantity, 1)
          ) {
            errors.push(
              `${at}.coveredProducts[${i}] needs lineItemTransactionId, productId and quantity >= 1`,
            );
          }
        }
      }
    } else {
      const product = line.product;
      if (
        !isRecord(product) ||
        typeof product.id !== "string" ||
        typeof product.category !== "string" ||
        !isInt(product.listPrice) ||
        !isInt(product.purchasePrice) ||
        !isInt(product.purchaseDate)
      ) {
        errors.push(
          `${at}.product needs id, category and integer listPrice, purchasePrice and purchaseDate`,
        );
      }
      if (
        line.plan !== undefined &&
        (!isRecord(line.plan) ||
          typeof line.plan.id !== "string" ||
          !isInt(line.plan.purchasePrice))
      ) {
        errors.push(`${at}.plan needs a string id and integer purchasePrice`);
      }
      if (typeof id === "string") productLines.set(id, line);
    }
  }

  // Covered products must exist in the same order and not exceed what was bought.
  for (const [index, line] of body.lineItems.entries()) {
    if (!isRecord(line) || line.type !== "category_contract") continue;
    if (!Array.isArray(line.coveredProducts)) continue;
    for (const item of line.coveredProducts) {
      if (!isRecord(item)) continue;
      const target = productLines.get(item.lineItemTransactionId);
      if (target === undefined) {
        errors.push(
          `lineItems[${index}] covers unknown line "${String(item.lineItemTransactionId)}"`,
        );
      } else if (isInt(item.quantity) && item.quantity > target.quantity) {
        errors.push(
          `lineItems[${index}] covers more units than line "${String(item.lineItemTransactionId)}" has`,
        );
      }
    }
  }
  return errors.slice(0, 20);
}

// --------------------------------------------------------------- offers

function buildOffer(fixtures, state, item) {
  const category = fixtures.categories[String(item.category).toLowerCase()];
  if (category === undefined) return null;
  const band = category.bands.find(
    (candidate) =>
      item.purchasePrice >= candidate.minPriceCents &&
      item.purchasePrice <= candidate.maxPriceCents,
  );
  if (band === undefined) return null;

  const toPlan = (plan) => ({
    id: plan.id,
    price: plan.price,
    title: plan.title,
    contract: {
      category: category.contractCategory,
      coverageIncludes: "adh",
      coverageStarts: "immediate",
      deductible: 0,
      termLength: plan.termLength,
    },
    url: `https://example.invalid/extend-mock/plans/${plan.id}`,
    offerPlanId: `ERN:OFP:MOCK-${plan.id}`,
    imageUrl: "https://example.invalid/extend-mock/icons/protection.png",
  });

  state.offerSeq += 1;
  return {
    offerId: `MOCK-OFFER-${String(state.offerSeq).padStart(4, "0")}`,
    marketing: {},
    plans: {
      adh: band.adh.map(toPlan),
      base: band.base.map(toPlan),
      recommended: band.recommended,
    },
    coveredProducts: [
      {
        productId: item.productId,
        quantity: item.quantity,
        purchasePrice: item.purchasePrice,
      },
    ],
  };
}

function offersResponse(fixtures, state, storeId, items) {
  state.offerCartSeq += 1;
  return {
    offerCartId: `MOCK-OFFERCART-${String(state.offerCartSeq).padStart(4, "0")}`,
    storeId,
    currency: fixtures.currency,
    locale: "en_US",
    offers: items
      .map((item) => buildOffer(fixtures, state, item))
      .filter((offer) => offer !== null),
    surfaceVersion: {},
  };
}

function validateOffersItems(items) {
  const errors = [];
  if (!Array.isArray(items) || items.length === 0) {
    return ["items must be a non-empty array"];
  }
  for (const [index, item] of items.entries()) {
    if (
      !isRecord(item) ||
      typeof item.category !== "string" ||
      item.category === "" ||
      typeof item.productId !== "string" ||
      item.productId === "" ||
      !isInt(item.purchasePrice) ||
      !isInt(item.quantity, 1)
    ) {
      errors.push(
        `items[${index}] needs category, productId, integer purchasePrice (cents) and quantity >= 1`,
      );
    }
  }
  return errors;
}

// ---------------------------------------------------------------- orders

function applyOrder(state, snapshot) {
  const previous = state.orders.get(snapshot.transactionId);
  const refunded = snapshot.status === "refunded";
  const events = [];
  const record = previous ?? { snapshot: null, contracts: new Map() };

  const previousLines = new Map(
    (previous?.snapshot.lineItems ?? []).map((line) => [
      line.lineItemTransactionId,
      line,
    ]),
  );
  const currentContractLineIds = new Set();

  for (const line of snapshot.lineItems) {
    if (!isContractLine(line)) continue;
    const id = line.lineItemTransactionId;
    currentContractLineIds.add(id);
    const covered = coveredProductsOf(line);
    const existing = record.contracts.get(id);
    const previouslyFulfilled = previousLines.get(id)?.fulfilledQuantity ?? 0;

    if (existing === undefined) {
      // Documented: a contract is issued only when fulfilledQuantity goes from 0 to a positive number.
      if (
        line.fulfilledQuantity > 0 &&
        previouslyFulfilled === 0 &&
        !refunded
      ) {
        state.contractSeq += 1;
        const contract = {
          contractId: `MOCK-CONTRACT-${String(state.contractSeq).padStart(4, "0")}`,
          lineItemTransactionId: id,
          planId: line.plan.id,
          status: "active",
          coveredProducts: covered,
        };
        record.contracts.set(id, contract);
        events.push({
          type: "contract_created",
          transactionId: snapshot.transactionId,
          lineItemTransactionId: id,
          contractId: contract.contractId,
        });
      }
    } else if (existing.status === "active") {
      const changed =
        canonical(existing.coveredProducts) !== canonical(covered) ||
        existing.planId !== line.plan.id;
      if (changed) {
        existing.coveredProducts = covered;
        existing.planId = line.plan.id;
        events.push({
          type: "contract_updated",
          transactionId: snapshot.transactionId,
          lineItemTransactionId: id,
          contractId: existing.contractId,
        });
      }
    }
  }

  // Documented: removing a line means omitting it from the snapshot.
  for (const [id, contract] of record.contracts) {
    if (!currentContractLineIds.has(id) && contract.status === "active") {
      contract.status = "cancelled";
      events.push({
        type: "contract_cancelled",
        transactionId: snapshot.transactionId,
        lineItemTransactionId: id,
        contractId: contract.contractId,
      });
    }
  }

  // Documented: order status "refunded" refunds the whole order and its contracts.
  if (refunded) {
    for (const contract of record.contracts.values()) {
      if (contract.status === "active") {
        contract.status = "refunded";
        events.push({
          type: "contract_refunded",
          transactionId: snapshot.transactionId,
          lineItemTransactionId: contract.lineItemTransactionId,
          contractId: contract.contractId,
        });
      }
    }
  }

  events.unshift({
    type: previous === undefined ? "order_created" : "order_updated",
    transactionId: snapshot.transactionId,
  });
  record.snapshot = snapshot;
  state.orders.set(snapshot.transactionId, record);
  state.events.push(...events);
}

// ----------------------------------------------------------------- server

/**
 * @param {{port?: number, host?: string, accessToken: string, storeId: string, fixtures?: object}} options
 */
export async function startMock(options) {
  const { accessToken, storeId } = options;
  if (
    typeof accessToken !== "string" ||
    accessToken === "" ||
    typeof storeId !== "string" ||
    storeId === ""
  ) {
    throw new Error("startMock needs accessToken and storeId");
  }
  const fixtures = options.fixtures ?? loadDefaultFixtures();

  const state = {
    /** One entry per request: method, path, status, noop. Never bodies or headers. */
    requests: [],
    /** Event log for assertions: order_created, order_updated, contract_created, ... */
    events: [],
    orders: new Map(),
    contractSeq: 0,
    offerSeq: 0,
    offerCartSeq: 0,
    /** Order records shaped like the reconcile module's ExtendStoredOrder. */
    storedOrders() {
      return [...this.orders.values()].map((record) => ({
        snapshot: JSON.parse(JSON.stringify(record.snapshot)),
        contracts: [...record.contracts.values()]
          .filter((contract) => contract.status === "active")
          .map((contract) => ({
            lineItemTransactionId: contract.lineItemTransactionId,
            contractId: contract.contractId,
          })),
      }));
    },
    contracts(transactionId) {
      const record = this.orders.get(transactionId);
      return record
        ? [...record.contracts.values()].map((c) => ({ ...c }))
        : [];
    },
    eventTypes() {
      return this.events.map((event) => event.type);
    },
  };

  let fault = null;
  const timers = new Set();

  const send = (res, status, body) => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "X-Extend-Mock": "true",
    });
    res.end(text);
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error("body too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

  const respond = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock.local");
    const record = {
      method: req.method,
      path: url.pathname,
      status: 0,
      noop: false,
    };
    state.requests.push(record);
    const reply = (status, body) => {
      record.status = status;
      send(res, status, body);
    };

    // Test-only fault injection runs first, like an outage in front of the API.
    if (
      fault &&
      (fault.path === "*" || fault.path === url.pathname) &&
      fault.remaining !== 0
    ) {
      if (fault.remaining > 0) fault.remaining -= 1;
      if (fault.delayMs) {
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            timers.delete(timer);
            resolve();
          }, fault.delayMs);
          timers.add(timer);
        });
        if (res.destroyed) return;
      }
      if (fault.status)
        return reply(fault.status, { message: "MOCK injected fault" });
      if (fault.body !== undefined) {
        record.status = 200;
        return send(res, 200, fault.body);
      }
    }

    const isMockRead = url.pathname === "/__mock/orders";
    if (
      url.pathname !== "/offers" &&
      url.pathname !== "/orders" &&
      !isMockRead
    ) {
      return reply(404, {
        message:
          "MOCK: unknown path (only /offers and /orders are implemented)",
      });
    }
    if (req.headers["x-extend-access-token"] !== accessToken) {
      return reply(401, {
        message: "MOCK: missing or invalid X-Extend-Access-Token",
      });
    }
    // MOCK ONLY, not an Extend endpoint: Extend documents no way to read orders back, so the reconcile script
    // (scripts/extend/reconcile.mjs) reads the mock's stored orders and contracts here. It does not exist on Extend.
    if (isMockRead) {
      if (req.method !== "GET") {
        return reply(405, { message: "MOCK: method not allowed for this path" });
      }
      return reply(200, { mock: true, orders: state.storedOrders() });
    }
    if (!String(req.headers.accept ?? "").includes(ACCEPT_VERSION)) {
      return reply(400, {
        message: `MOCK: Accept header must carry ${ACCEPT_VERSION}`,
      });
    }

    if (url.pathname === "/offers" && req.method === "GET") {
      const query = url.searchParams;
      const item = {
        category: query.get("category") ?? "",
        productId: query.get("productId") ?? "",
        purchasePrice: Number(query.get("purchasePrice")),
        quantity: 1,
      };
      if (query.get("storeId") !== storeId) {
        return reply(400, {
          message: "MOCK: storeId does not match this store",
        });
      }
      const errors = validateOffersItems([item]);
      if (errors.length > 0)
        return reply(400, { message: "MOCK validation failed", errors });
      return reply(200, offersResponse(fixtures, state, storeId, [item]));
    }

    if (url.pathname === "/offers" && req.method === "POST") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return reply(400, { message: "MOCK: body is not valid JSON" });
      }
      const errors = [];
      if (!isRecord(body)) errors.push("body must be a JSON object");
      else {
        if (body.storeId !== storeId)
          errors.push("storeId does not match this store");
        if (typeof body.currency !== "string" || body.currency.length !== 3) {
          errors.push("currency must be a 3-letter code");
        }
        errors.push(...validateOffersItems(body.items));
      }
      if (errors.length > 0)
        return reply(400, { message: "MOCK validation failed", errors });
      return reply(200, offersResponse(fixtures, state, storeId, body.items));
    }

    if (url.pathname === "/orders" && req.method === "PUT") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return reply(400, { message: "MOCK: body is not valid JSON" });
      }
      const errors = validateOrderBody(body, storeId);
      if (errors.length > 0)
        return reply(400, { message: "MOCK validation failed", errors });

      const previous = state.orders.get(body.transactionId);
      if (previous && canonical(previous.snapshot) === canonical(body)) {
        // Idempotent: the same full snapshot changes nothing.
        record.noop = true;
        return reply(200, { mock: true });
      }
      applyOrder(state, JSON.parse(JSON.stringify(body)));
      return reply(200, { mock: true });
    }

    return reply(405, { message: "MOCK: method not allowed for this path" });
  };

  const server = http.createServer((req, res) => {
    respond(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { message: "MOCK internal error" });
      else res.end();
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve);
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;

  return {
    url: `http://${options.host ?? "127.0.0.1"}:${port}`,
    port,
    state,
    /** Test hook: {path: '/offers'|'/orders'|'*', status?, delayMs?, body?, remaining?}. remaining counts requests. */
    setFault(spec) {
      fault = { path: "*", remaining: -1, ...spec };
    },
    clearFault() {
      fault = null;
    },
    close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

// -------------------------------------------------------------------- CLI

function isMainModule() {
  if (!process.argv[1]) return false;
  const self = path.resolve(fileURLToPath(import.meta.url));
  const entry = path.resolve(process.argv[1]);
  return process.platform === "win32"
    ? self.toLowerCase() === entry.toLowerCase()
    : self === entry;
}

if (isMainModule()) {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf("--port");
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 4010;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("Usage: node scripts/mocks/extend-mock.mjs [--port 4010]");
    process.exit(2);
  }
  const accessToken = process.env.EXTEND_MOCK_ACCESS_TOKEN || CLI_DEFAULT_TOKEN;
  const storeId = process.env.EXTEND_MOCK_STORE_ID || CLI_DEFAULT_STORE_ID;
  const mock = await startMock({ port, accessToken, storeId });
  console.log(
    `MOCK Extend API listening on ${mock.url} (not Extend; documented subset only)`,
  );
  console.log(
    `Point the storefront at it with EXTEND_API_HOST=${mock.url} and EXTEND_STORE_ID=${storeId}.`,
  );
  console.log(
    "EXTEND_ACCESS_TOKEN must equal EXTEND_MOCK_ACCESS_TOKEN (local default: CLI_DEFAULT_TOKEN in this file). Ctrl+C to stop.",
  );
  const stop = () => {
    mock.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
