# Visit requests ("Plan your visit" form)

Status: built and unit-tested with a stubbed Shopify; **not verified on a store** (CR-33, DEC-144).

## What happens
1. The home-page form (`components/home/LeadForm.tsx`) checks the answers in the browser, then posts to `POST /visit-request`.
2. The server (`lib/leads/visit-handler.ts`) allows same-origin posts only, drops honeypot posts quietly, rate limits (per client address, per phone number, overall), validates again, then saves once.
3. `lib/leads/customer-client.ts` calls the Admin GraphQL API: `customerCreate` (first name, last name, phone, note, tags). If Shopify says the phone is taken, it finds that customer by phone and adds the tags with `tagsAdd`.
4. The lead analytics event (`generate_lead`) fires only after the server says the request was saved.

## Where the store team sees them
Shopify admin, Customers, filter by tag `visit-request`. Other tags: `visit-budget-<range>`, `visit-window-<when>`, `visit-zip-<zip>`. New customers also get a note with the same answers in words. The customer is created **without** email or text marketing consent.

## Setup (needs the owner)
- Create a custom app (or add to the existing one) with **only** `write_customers` and `read_customers`, and put its Admin API token in `SHOPIFY_CUSTOMER_ADMIN_API_ACCESS_TOKEN` on the server. It must not be the `read_orders` token or the importer token.
- `PUBLIC_STORE_DOMAIN` must be the `<shop>.myshopify.com` name. Set `TRUSTED_CLIENT_IP_HEADER` (`x-real-ip` on the VPS) so the per-address limit works.
- Without the token the form answers "could not send your request right now" (503, log `visit_request.unavailable`). Nothing is faked.

## To verify on a development store
Submit a test request (fictional 555 number): a customer appears with the tags and note. Submit again with the same number: the tags are added, no second customer. A token without the scope logs `visit_request.upstream_failed` with reason `auth`. The field names used (`customerCreate`, `tagsAdd`, `customers(query: "phone:...")`) follow the Admin API reference and have not been run.

## Privacy
Name and phone are stored in Shopify only. Logs hold event names and reason codes, never personal data. The form tells the visitor the details are used only to arrange the visit.
