// SERVER ONLY. Reads and writes the signed-in customer's quiz result through the Customer Account API
// (REQ-QZ-005, P6-04). The customer is always the one in the session: the owner id comes from a query made with
// the shopper's own token, never from the request.
//
// Documented behaviour this relies on (docs/integrations/QUIZ_ACCOUNT_SYNC.md):
//   - `Customer.metafield(namespace, key)` to read; `metafieldsSet` and `metafieldsDelete` to write (Customer Account
//     API, writes available since 2024-07).
//   - The metafield definition must give the Customer Account API READ_WRITE access, and the app needs the
//     `customer_read_customers` / `customer_write_customers` scopes. Neither is verified on the client's store
//     (V-08), so every failure here resolves to `unavailable` and the quiz carries on with the device copy.
// Nothing here logs answers, handles, ids or Shopify's message text: only a short reason code (T-05).

import type {CustomerAccount, Storefront} from '@shopify/hydrogen';
import {logError, logWarn} from '~/lib/logging/logger';
import {getQuizConfigRaw, getQuizProducts} from '~/lib/pages/data-source';
import {
  buildAccountSummary,
  parseAccountSummary,
  parseSyncRequest,
  serializeAccountSummary,
  type AccountQuizSummary,
} from '~/lib/quiz/account-sync';
import {fingerprintConfig} from '~/lib/quiz/config';
import {resolveQuizConfig} from '~/lib/quiz/default-config';
import {scoreProducts} from '~/lib/quiz/score';
import {QUIZ_ACCOUNT_METAFIELD} from '~/lib/quiz/storage';
import type {QuizConfig} from '~/lib/quiz/types';

type AccountClient = Pick<CustomerAccount, 'query' | 'mutate'>;

const READ_QUERY = `
  query QuizResultRead($namespace: String!, $key: String!) {
    customer {
      id
      metafield(namespace: $namespace, key: $key) {
        value
      }
    }
  }
`;

const SET_MUTATION = `
  mutation QuizResultSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        key
      }
      userErrors {
        code
      }
    }
  }
`;

const DELETE_MUTATION = `
  mutation QuizResultDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields {
        key
      }
      userErrors {
        code
      }
    }
  }
`;

type ReadShape = {
  customer?: {
    id?: string;
    metafield?: {value?: string | null} | null;
  } | null;
};

type WriteShape = {
  metafieldsSet?: {userErrors?: {code?: string | null}[]} | null;
  metafieldsDelete?: {userErrors?: {code?: string | null}[]} | null;
};

export type AccountReadResult =
  | {
      readonly status: 'ok';
      readonly customerId: string;
      readonly summary: AccountQuizSummary | null;
    }
  | {readonly status: 'signed_out'}
  | {readonly status: 'unavailable'};

export type AccountWriteResult =
  | {readonly status: 'ok'}
  | {readonly status: 'signed_out'}
  | {readonly status: 'unavailable'};

/** Shopify's error codes are short enumerations; anything else is dropped before logging. */
function codesOf(errors: readonly {code?: string | null}[] | undefined) {
  return (errors ?? []).map((error) =>
    typeof error.code === 'string' && /^[A-Z_]{1,40}$/.test(error.code)
      ? error.code
      : 'UNKNOWN',
  );
}

export async function readAccountQuiz(
  client: AccountClient,
): Promise<AccountReadResult> {
  try {
    const {data, errors} = await client.query<ReadShape>(READ_QUERY, {
      variables: {
        namespace: QUIZ_ACCOUNT_METAFIELD.namespace,
        key: QUIZ_ACCOUNT_METAFIELD.key,
      },
    });
    const customer = data?.customer;
    if (errors?.length || !customer || typeof customer.id !== 'string') {
      logWarn('quiz.account_read_failed', {
        reason: errors?.length ? 'graphql_errors' : 'no_customer',
      });
      return {status: 'unavailable'};
    }
    const parsed = parseAccountSummary(customer.metafield?.value);
    return {
      status: 'ok',
      customerId: customer.id,
      summary: parsed.status === 'ok' ? parsed.summary : null,
    };
  } catch (error: unknown) {
    // The client throws a redirect Response when the session has ended.
    if (error instanceof Response) return {status: 'signed_out'};
    logError('quiz.account_read_failed', {reason: 'exception'});
    return {status: 'unavailable'};
  }
}

export async function writeAccountQuiz(
  client: AccountClient,
  customerId: string,
  json: string,
): Promise<AccountWriteResult> {
  try {
    const {data, errors} = await client.mutate<WriteShape>(SET_MUTATION, {
      variables: {
        metafields: [
          {
            ownerId: customerId,
            namespace: QUIZ_ACCOUNT_METAFIELD.namespace,
            key: QUIZ_ACCOUNT_METAFIELD.key,
            type: QUIZ_ACCOUNT_METAFIELD.type,
            value: json,
          },
        ],
      },
    });
    const userErrors = data?.metafieldsSet?.userErrors;
    if (errors?.length || (userErrors?.length ?? 0) > 0 || !data) {
      // ACCESS_DENIED here usually means the definition does not allow customer-account writes.
      logWarn('quiz.account_write_failed', {
        reason: errors?.length ? 'graphql_errors' : 'user_errors',
        codes: codesOf(userErrors),
      });
      return {status: 'unavailable'};
    }
    return {status: 'ok'};
  } catch (error: unknown) {
    if (error instanceof Response) return {status: 'signed_out'};
    logError('quiz.account_write_failed', {reason: 'exception'});
    return {status: 'unavailable'};
  }
}

export async function deleteAccountQuiz(
  client: AccountClient,
  customerId: string,
): Promise<AccountWriteResult> {
  try {
    const {data, errors} = await client.mutate<WriteShape>(DELETE_MUTATION, {
      variables: {
        metafields: [
          {
            ownerId: customerId,
            namespace: QUIZ_ACCOUNT_METAFIELD.namespace,
            key: QUIZ_ACCOUNT_METAFIELD.key,
          },
        ],
      },
    });
    const userErrors = data?.metafieldsDelete?.userErrors;
    if (errors?.length || (userErrors?.length ?? 0) > 0 || !data) {
      logWarn('quiz.account_delete_failed', {
        reason: errors?.length ? 'graphql_errors' : 'user_errors',
        codes: codesOf(userErrors),
      });
      return {status: 'unavailable'};
    }
    return {status: 'ok'};
  } catch (error: unknown) {
    if (error instanceof Response) return {status: 'signed_out'};
    logError('quiz.account_delete_failed', {reason: 'exception'});
    return {status: 'unavailable'};
  }
}

export type PreparedSave =
  | {
      readonly status: 'ok';
      readonly json: string;
      readonly summary: AccountQuizSummary;
    }
  | {readonly status: 'invalid'};

/**
 * Turns the posted payload into the stored value: answers are checked against the live quiz configuration and
 * the handles are recomputed from the same recommendation source the quiz page scores against.
 */
export async function prepareAccountSave(
  rawPayload: unknown,
  nowMs: number,
  storefront?: Storefront,
): Promise<PreparedSave> {
  const [rawConfig, catalog] = await Promise.all([
    getQuizConfigRaw(storefront),
    getQuizProducts(),
  ]);
  const config: QuizConfig = resolveQuizConfig(rawConfig).config;
  const request = parseSyncRequest(rawPayload, config, nowMs);
  if (request.status !== 'ok') return {status: 'invalid'};
  const summary = buildAccountSummary({
    answers: request.answers,
    savedAt: request.savedAt,
    outcome: scoreProducts(request.answers, catalog.products, config),
    configFingerprint: fingerprintConfig(config),
  });
  const serialized = serializeAccountSummary(summary);
  return serialized.status === 'ok'
    ? {status: 'ok', json: serialized.json, summary}
    : {status: 'invalid'};
}
