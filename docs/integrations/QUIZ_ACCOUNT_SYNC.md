# Quiz result saved to the customer account (REQ-QZ-005, P6-04)

Status: **implemented, unverified.** Built against the documented Customer Account API; never run against the client's store or a browser (V-08 still open). Tests deferred (owner decision, 2026-10-26).

## What is saved, and where

| Place | Key | Content | Code |
|---|---|---|---|
| Device (`localStorage`) | `quiz.saved` | versioned envelope: answers, per-result handle, size, score, reasons; 8 KB cap; 180 days; validated on read; every failure is swallowed | `app/lib/quiz/storage.ts` (existed), `app/lib/pages/browser-storage.ts` |
| Customer account | customer metafield `custom.quiz_result`, type `json` | `{v:1, savedAt, configFingerprint, answers, handles}`; 4 KB cap; handles at most 3 | `app/lib/quiz/account-sync.ts` |

No free text, no names, no email, no prices, no variant ids. Quiz answers are option ids from the quiz configuration.

## Verified from official Shopify documentation (2026-10-26)

- The Customer Account API has a `metafieldsSet` mutation (and `metafieldsDelete`): https://shopify.dev/docs/api/customer/latest/mutations/metafieldsSet and https://shopify.dev/docs/api/customer/latest/mutations/metafieldsDelete. Writes "available as of the 2024-07 version of the Customer Account API"; access follows the owner type of `ownerId` (a Customer).
- Guide: https://shopify.dev/docs/apps/build/customer-accounts/metafields. The metafield definition must set the customer-account access to `read_write` (`access.customer_account = "read_write"` in the app TOML example); scopes `customer_read_customers` and `customer_write_customers`; writes work on Customer, Order, Company, CompanyLocation; the Customer Account API needs Level 1 protected customer data access.
- Reading: `Customer.metafield(namespace, key)` (https://shopify.dev/docs/api/customer/latest/objects/Customer).
- Admin API definitions can set `access.customerAccount` to `NONE`, `READ` or `READ_WRITE` (`MetafieldAccessInput`, `MetafieldCustomerAccountAccess`): https://shopify.dev/docs/api/admin-graphql/latest/input-objects/MetafieldAccessInput.
- `metafieldsSet`, `metafieldsDelete`, `MetafieldsSetInput` and `MetafieldIdentifierInput` exist in the schema bundled with the installed Hydrogen (2026.4.7): `node_modules/@shopify/hydrogen/dist/customer-account-api-types.d.ts`.
- `MetafieldsSetInput`: namespace 3 to 255 characters, key 2 to 64; `type` required when no definition exists.

## Assumed, not verified on the client's store

1. The docs show the definition created in an **app** TOML (`$app` namespace). They do not say whether a definition in namespace `custom` with `customerAccount: READ_WRITE` is accepted. If it is not, change `QUIZ_ACCOUNT_METAFIELD.namespace` (one constant in `storage.ts`) to an app-reserved namespace.
2. The headless/Hydrogen sales channel's Customer Account API session carries the `customer_write_customers` scope. Not checked.
3. Level 1 protected customer data access is granted for this app. Not checked.
4. The definition exists. It is now in `scripts/shopify/definitions.json` (owner type CUSTOMER, `customerAccountAccess` READ_WRITE, Storefront access NONE; applied by `apply-definitions.mjs`, tested on a fake only). Create it once on the development store, for example through the Admin GraphQL `metafieldDefinitionCreate` with `ownerType: CUSTOMER`, `namespace: custom`, `key: quiz_result`, `type: json`, `access: {customerAccount: READ_WRITE}`; then add it to the definitions spec.

If any assumption fails, nothing breaks: `metafieldsSet` returns user errors, the server logs a short reason code (for example `ACCESS_DENIED`), the browser gets `unavailable`, and the quiz keeps working with the device copy. The account page then says the result is kept on this device. That is the documented fallback; no other API is used.

## Behaviour

- **Save.** On finishing the quiz, the result goes to the device and, when signed in (root loader `isLoggedIn`), to `POST /account/quiz-sync`. Signed-out shoppers make no request.
- **Endpoint** (`app/routes/account_.quiz-sync.tsx`, outside the account layout so it answers JSON and never redirects): `GET` read, `POST` save, `DELETE` clear. Same-origin check, signed-in check, body cap, `Cache-Control: private, no-store`. The customer is the session's; the owner id comes from a query made with the shopper's own token.
- **Validation (server).** The browser sends answers and a time only. Answers are restricted to questions and options in the live quiz configuration (a single-select keeps one option); the time is clamped to now; the handles are recomputed on the server by scoring the answers against the same recommendation source the quiz page uses, so a forged handle cannot be written. No payload value is trusted or logged.
- **Sign-in merge.** On the quiz intro, signed in: newer device copy is uploaded quietly; if this device has no copy and the account has one, the page offers "Restore your saved results"; the account wins a tie only through that offer. A signed-out shopper with a device copy sees "Sign in to keep your results across devices".
- **Account page** `/account/quiz` ("Your sleep quiz result"): date, answers, top matches (shown only if still in the recommendation source), retake link, and "Clear my saved result". Linked from the account menu.
- **Clearing.** "Clear saved results" or retaking on the quiz clears the device copy and, when signed in, deletes the metafield.
- **Logging.** Reason codes only (`quiz.account_read_failed`, `quiz.account_write_failed`, `quiz.account_delete_failed`); no ids, answers, handles or Shopify message text.

## Files

`app/lib/quiz/account-sync.ts` (pure rules), `account-sync.server.ts` (Customer Account API calls), `account-sync-client.ts` (browser fetch wrappers), `app/components/quiz/useAccountQuizSync.ts`, `app/components/quiz/QuizIntro.tsx`, `app/routes/quiz._index.tsx`, `app/routes/account.quiz.tsx`, `app/routes/account_.quiz-sync.tsx`, `app/routes/account.tsx` (one menu link), `app/lib/quiz/storage.ts` (key renamed `quiz_results` to `quiz_result`; two helpers exported).

## Open

- V-08 on the development store: create the definition, sign in, finish the quiz, read `custom.quiz_result` in the admin.
- Unit and e2e tests for this feature: deferred.
- The account page and menu use the scaffold's plain account styling, like the other account routes.
