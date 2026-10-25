# Financing messages (P4-08, REQ-CART-005)

Status: built behind an environment switch, hidden by default. Not verified against any store, browser or provider account (tests and QA deferred by the owner, 2026-10-26). The requirement stays `Pending approval`: the wording is placeholder copy until the client approves it, and no option is activated yet (CLR-007, CLR-008, Q-016).

## What exists

A message slot, `app/components/cart/FinancingMessage.tsx`, in three places: the cart drawer and the cart page (in the order summary, through `CartSummary`) and the product page's price area (`ProductBuyBox`). It renders **nothing** unless `PUBLIC_FINANCING_PROVIDER` is set to one of three exact values (no trimming, no case folding; anything else is hidden, and a refused value is logged once as `financing.config_refused` with the reason only).

| `PUBLIC_FINANCING_PROVIDER` | What shows | Needs |
|---|---|---|
| unset (default) | nothing | |
| `shop-pay-installments` | a fixed sentence naming Shop Pay Installments (`SHOP_PAY_INSTALLMENTS_COPY`, placeholder). No amount, term, fee or monthly figure | the client has activated Shop Pay Installments (CLR-007) |
| `affirm` | Affirm's own "as low as" element, drawn by Affirm.js | `PUBLIC_AFFIRM_PUBLIC_KEY`; see below |
| `store-card` | one line of plain text from the client | `STORE_CARD_MESSAGE` (server env, at most 200 characters; control characters and angle brackets are removed; empty or too long means hidden) and the client's card programme (CLR-008) |

No monthly figure is ever computed by us (SD-11). The only figure on a page is one Affirm.js draws itself from the Shopify amount (the selected variant's price on the product page, the cart subtotal in the cart) which we hand it in USD cents. The browser computes no price.

## Affirm

Verified from Affirm's official documentation, read 2026-10-26:

- "Set Up Promotional Messaging", https://docs.affirm.com/developers/docs/set-up-promotional-messaging (updated 2026-07-15): Affirm.js is embedded with `_affirm_config` (`public_api_key`, `script`, `locale: "en_US"`, `country_code: "USA"`); sandbox script `https://cdn1-sandbox.affirm.com/js/v2/affirm.js`, production script `https://cdn1.affirm.com/js/v2/affirm.js`; the placement is `<p class="affirm-as-low-as" data-page-type="product|cart|homepage" data-amount="<cents>">`; after a price change, update `data-amount` and call `affirm.ui.refresh()` (inside `affirm.ui.ready(...)` when Affirm.js may not have loaded yet).
- "HTML Reference: Promotional Messaging", https://docs.affirm.com/developers/docs/html-reference-promotional-messaging: `data-amount` is an integer in USD cents; `data-page-type` is required (`homepage`, `landing`, `search`, `category`, `product`, `cart`, `payment`, `banner`, `marketplace`).

Implementation: `app/lib/financing/affirm.ts` is a typed port of Affirm's embed snippet (queueing stub, then `affirm.checkout(config)`, then an async `<script>`), so no inline script and no CSP nonce are needed. `app/components/cart/AffirmPromo.tsx` is a lazy chunk, requested only when the provider is `affirm`. The embed snippet was ported by reading it, not copied byte for byte: **check it against the real sandbox script** before relying on it.

Consent (decided conservatively, mirroring the chat): `PUBLIC_AFFIRM_REQUIRES_CONSENT` defaults to true. Then nothing renders and no script is requested until the shopper allows the `analytics` category, which also needs `PUBLIC_GA4_MEASUREMENT_ID` so the banner offers that category (otherwise the Affirm slot is refused as `affirm_needs_consent_category`, as for the chat). Only the exact text `false` removes the wait; whether the client may is a legal decision (Q-012, T-16). Withdrawing consent hides the element immediately; Affirm.js, once loaded, stays in the page until the next full load.

`PUBLIC_AFFIRM_ENVIRONMENT`: the exact text `production` uses the production script; anything else, including unset, uses the sandbox (fail safe: no real financing from a misconfigured store).

Content Security Policy: the script origin of the configured environment is added to `script-src` in the enforced and the report-only policy, from one merged object in `entry.server.tsx` (`app/lib/financing/hosts.ts`), and nothing is added when Affirm is not configured. **UNVERIFIED:** Affirm's documentation pages read publish no CSP host list. The hosts Affirm.js itself calls (promotional-message data, the learn-more modal frame, images) are therefore NOT in the policy and the element may stay empty under the enforced policy. Next step: run staging in report-only with a sandbox key, open each placement and the modal, and add only hosts actually seen blocked, quoting where they were seen. No wildcard, no guess.

Not verified: that Affirm is activated on the client's store (CLR-007, Q-016); Affirm's marketing compliance guidelines (linked from the setup page) have not been read or applied; Affirm's minimum order amount behaviour (the element decides; we hide only when the amount is missing, not USD or zero).

## Shop Pay Installments

Wording is a placeholder: "Pay over time with Shop Pay Installments. Eligible orders can choose it at checkout." It states no amount or term. Shop Pay Installments availability, eligibility range and terms on the client's store are unverified (CLR-007); do not set the provider until the client has confirmed it is switched on in Shopify admin, and approve the wording.

## Store card

Text only, from `STORE_CARD_MESSAGE` (server only; reaches the page through the root loader). The copy must come from the client (CLR-008). A card programme link or application flow is not built.

## Placeholders and what removes them

| Placeholder | Removed by |
|---|---|
| Shop Pay Installments sentence | client wording approval (Q-016) |
| Affirm CSP completeness (UNVERIFIED hosts) | staging report-only pass with a sandbox key |
| Store-card text | client supplies `STORE_CARD_MESSAGE` (CLR-008) |
| Affirm marketing compliance review | client or Affirm account contact |
