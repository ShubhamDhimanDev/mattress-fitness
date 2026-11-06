# Newsletter signups as Shopify customers (tag `subscribe`)

Owner request 2026-11-06 (REQ-ANL-003, CR-34, DEC-150). Code: `storefront/app/lib/signup/shopify-customer.ts`,
`combined-subscriber.ts`, wired in `handler.ts`.

## What happens on a signup

After the usual checks (same origin, rate limit, honeypot, explicit unticked consent), the server:

1. looks the address up (`customerByIdentifier`);
2. **new address:** `customerCreate` with `tags: ["subscribe"]` and `emailMarketingConsent` (SUBSCRIBED, SINGLE_OPT_IN, now);
3. **known address:** `tagsAdd` with `subscribe`, then `customerEmailMarketingConsentUpdate` to SUBSCRIBED (the shopper just
   ticked the consent box). If a create races another request, it looks the address up again and tags that customer.

The signup's other destination (Klaviyo, or the SMTP email to the team) still runs. The shopper sees "thank you" when either
took the signup; the one that failed is logged (`signup.destination_failed`, reason code only).

## Setup (owner / developer)

1. In the Shopify admin (or Dev Dashboard) create a custom app with Admin API scopes `write_customers` and `read_customers`
   only. Do not add these to the read_orders token: the two credentials stay separate.
2. Put its Admin API access token in the server environment as `SHOPIFY_CUSTOMERS_ADMIN_API_ACCESS_TOKEN` (name only in
   `storefront/.env.example`; never in a file or a log). `PUBLIC_STORE_DOMAIN` must be the `<shop>.myshopify.com` domain.
3. Filter in Shopify admin: Customers, then "Tagged with" `subscribe`.

Without the token no customer is created and nothing is faked; with only the token set the signup form still shows.

## Status

**Unverified against the client's store and API version 2026-10.** Run one signup on the development store and check: a new
customer with the tag and "Subscribed" email marketing; the same address again adds no duplicate; a wrong token shows "try again
later" and a warning in the logs. Record the result in `progress/TEST_RESULTS.md`.
