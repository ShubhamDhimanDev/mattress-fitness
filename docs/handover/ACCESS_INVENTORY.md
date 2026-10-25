# Access and accounts inventory

Deliverable H-06 (task P9-08; supports REQ-HAND-001 to REQ-HAND-005). **Draft 1, dated 2026-10-26, branch `feat/remaining-scope-fast`.** Written from `.env.example`, `deploy/mattressfitness.env.example`, [DEPLOYMENT](../deployment/DEPLOYMENT.md), [VPS_RUNBOOK](../deployment/VPS_RUNBOOK.md), [RUNBOOKS](RUNBOOKS.md) section 5 and the integration documents. **Nothing in it has been checked against a live account, a server or a store: no account in this list has been created by us yet except where a row says so.**

**No secret value appears in this file and none ever may.** It records names, owners, where a value lives and what happens if it is lost. If you find a value here, stop, do not copy it, tell the project owner and rotate it (RUNBOOKS section 5.1).

## How to read the tags

| Tag | Meaning |
|---|---|
| `[verified]` | Read in the repository's code, templates or documents on the date above. Not seen working on a live account |
| `[assumed]` | Our working assumption; confirm it before relying on it |
| `[client input needed]` | Only the client (or the project owner for interim items) can fill it in |
| `UNVERIFIED` | A provider behaviour we have not seen (V-xx numbers are in [TECH_FEASIBILITY](../research/TECH_FEASIBILITY.md) section 4) |

## Rules for everyone

1. Every production secret lives in exactly two places: the host's secret store (on the VPS: `/etc/mattressfitness/env`, owner `root:root`, mode `0600`) and the owner's password manager. `[verified]` (VPS_RUNBOOK section 5)
2. Never in the repository, a ticket, chat, e-mail, shell history, log or build output. `.env` files are git-ignored; only `.env.example` and `deploy/mattressfitness.env.example` (names and placeholders) are tracked. `[verified]`
3. A value that touched staging or a developer machine is **replaced** before launch (phase 9, security considerations). Production values are generated fresh.
4. Names without the `PUBLIC_` prefix are server-only. `PUBLIC_` values are sent to browsers on purpose and are identifiers, not secrets. `[verified]`
5. Each row's "Owner" is who may rotate or revoke it after handover. Until handover the interim holder is the project owner.

## 1. Platform and repository accounts

| # | Account or service | Used for | Owner at handover | Where the login lives | Rotation and renewal | If lost or locked |
|---|---|---|---|---|---|---|
| A-01 | Shopify store (Basic plan, owner-confirmed 2026-10-12) | Products, orders, checkout, customers, content. The source of truth (NFR-006) | Client `[client input needed]`: named store owner | Client's Shopify login and 2-step verification `[assumed]` | Shopify subscription renewal date `[client input needed]` | The store cannot be run. Recovery is Shopify's account recovery, not ours |
| A-02 | Shopify staff or collaborator access for our team | Setup, verification, launch-day support | Client grants; Collaborator access vs Basic staff seats is V-21 `UNVERIFIED` | Our own Shopify login (never shared) | Remove our access at the end of launch-day support `[assumed]`. Record the date here | We cannot help on launch day. Nothing in production breaks |
| A-03 | Shopify Partner account and development store(s) | Our test stores. The only store that has answered so far is the owner's dev store (read and cart paths only, [REAL_STORE_FINDINGS](../testing/REAL_STORE_FINDINGS.md)) | Project owner (ours, not transferred) | Owner's password manager | n/a | Verification work stops. Production unaffected |
| A-04 | Online Store password on the dev store | Blocks checkout hand-off tests (B-25). Owner agreed to remove it (DEC-075); not yet done | Project owner | If kept, in a secret store outside the repository | n/a | Cart-equals-checkout tests stay blocked |
| A-05 | Client GitHub organisation and the repository | Source code owned by the client (REQ-HAND-001) | Client `[client input needed]` (Q-014: organisation not yet known) | Client's GitHub login with 2-step verification | Review org admins yearly `[assumed]` | Code remains in the client's other copies. Loss of org admin means no deploys from a remote |
| A-06 | Repository access for the deployer | Fetching tagged releases onto the VPS | Client `[client input needed]` | Read-only deploy key held by `deploy` on the VPS (`~/.ssh`) `[verified]` (VPS_RUNBOOK 6A) | Rotate when staff change; remove if the repository moves | Deploys by tarball still work (VPS_RUNBOOK 6B) |
| A-07 | Branch protection and required reviews | Merge control on the client's repository | Client org admins | GitHub settings | Set at transfer (phase 9 security) `[assumed]` | n/a |

CI is **not used** by owner decision (DEC-080): no CI secrets exist. `.github/workflows/ci.yml` is kept and uses no secrets. `[verified]`

## 2. Shopify credentials (names in `.env.example`)

| # | Name | Exposure | What it is | Where it lives | Rotation | If lost or wrong |
|---|---|---|---|---|---|---|
| S-01 | `PUBLIC_STORE_DOMAIN` | public | The store's `<shop>.myshopify.com` name. Must be the `myshopify.com` name for the webhook order read | Env file | Changes only if the store is renamed | Storefront cannot reach Shopify; the server refuses to start `[verified]` |
| S-02 | `PUBLIC_STOREFRONT_API_TOKEN` | public | The channel's public Storefront API token | Env file; source is the Hydrogen or Headless channel in Shopify admin | How to regenerate is `UNVERIFIED` (RUNBOOKS 5.3). Check a product page and add to cart afterwards | No products or cart; server refuses to start `[verified]` |
| S-03 | `PRIVATE_STOREFRONT_API_TOKEN` | server | The channel's private token, read by Hydrogen if present | Env file | As S-02 | Hydrogen falls back to the public token behaviour `[assumed]` |
| S-04 | `PUBLIC_CHECKOUT_DOMAIN` | public | The store's checkout domain. Also feeds the CSP `connect-src` and `form-action` | Env file | Changes if the checkout domain changes (see CUTOVER_AND_DNS) | Checkout links wrong; server refuses to start `[verified]` |
| S-05 | `PUBLIC_STOREFRONT_ID` | public, optional | Channel storefront ID; only labels the analytics sub-channel | Env file (commented out in the VPS template) | n/a | Analytics attribution degrades only `[verified]` |
| S-06 | `PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID`, `PUBLIC_CUSTOMER_ACCOUNT_API_URL`, `SHOP_ID` | public, public, **server** | Customer Account API for `/account` sign-in | Env file; callback and logout URLs are set in Shopify admin and must name the live domain | **Update the callback URLs at cutover** (CUTOVER_AND_DNS). Not verified on a store (V-08) | Sign-in fails. Browsing and checkout still work |
| S-07 | `SHOPIFY_APP_CLIENT_ID` | server | Dev Dashboard app (custom distribution on the client's store) | Env file `[verified]` that the name exists; reserved, read by no code today | Rotate with the app | None today |
| S-08 | `SHOPIFY_APP_CLIENT_SECRET` | server | The app's client secret. **Also verifies webhook signatures; there is no separate webhook secret** (ADR-0009 addendum) | Env file + password manager | RUNBOOKS 5.3: old and new differ while rotating, signatures fail, Shopify retries about 4 hours; do it quietly, check with a resent webhook. Where it is displayed is `UNVERIFIED` (V-12) | `/webhooks/shopify` answers 503; no order sync or order check |
| S-09 | `SHOPIFY_ADMIN_API_ACCESS_TOKEN` (**storefront copy**) | server | Offline token with **`read_orders` only**. Used by the webhook order read and the guest order lookup | Env file + password manager | Authorization-code grant on the client's store (V-20 `UNVERIFIED`). After rotation check a paid test order logs `detective.checked` and a lookup logs `guest_lookup.completed` | Guest lookup shows "not available"; order check logs `detective.skipped`. A separate app and token for the lookup alone is advised (security review L-7) |
| S-10 | `SHOPIFY_ADMIN_API_ACCESS_TOKEN` (**importer copy**) plus `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ALLOWED_STORES`, `SHOPIFY_ADMIN_API_VERSION` | local shell only | Product-write token for `scripts/catalog` and `scripts/shopify`. **Same variable name, different token and power from S-09** | A developer's shell, from the password manager. **Never on the server or in a file** `[verified]` | Create for each import session if possible; revoke after | No import possible. Storefront unaffected. The token has not been created yet (B-27, DEC-076) |
| S-11 | Webhook subscription on the app | Order and refund events to `https://<DOMAIN>/webhooks/shopify` (`orders/paid`, `orders/updated`, `orders/cancelled`, `refunds/create`, `fulfillments/create`) | Client store owner (subscription), us (setup) | Shopify admin / app configuration | Re-point at cutover if the domain changes | No Extend sync or detective check. Not created anywhere yet (V-20) |

## 3. Third-party providers

None of these accounts exists yet, except where noted. The provider-dependent features are **not live** until the account and the provider's approval exist (SOW section 13).

| # | Provider | Names | Used for | Owner at handover | Rotation | If lost or wrong |
|---|---|---|---|---|---|---|
| P-01 | Extend (merchant account, Merchant Portal) | `EXTEND_API_HOST`, `EXTEND_STORE_ID`, `EXTEND_ACCESS_TOKEN`, `EXTEND_ORDER_SYNC`, `PUBLIC_EXTEND_ENABLED` | Accident protection offers and order sync | Client `[client input needed]` (Q-005, B-03). Built against a local mock only (DEC-078). Demo and production credentials are separate | Rotation steps are not documented by Extend `UNVERIFIED` (RUNBOOKS 5.3). Client ID and Secret are exchanged for an access token | Extend flag stays off or the config reads as disabled. With the flag on and the coverage catalog unreadable, checkout is paused (DEC-034). **A production build refuses the local mock host** `[verified]` |
| P-02 | Klaviyo (account, one list, one private key) | `KLAVIYO_PRIVATE_API_KEY`, `KLAVIYO_LIST_ID`, `PUBLIC_KLAVIYO_SMS_ENABLED`; reserved: `PUBLIC_KLAVIYO_COMPANY_ID` | Email signup form (SMS off in production, DEC-115) | Client `[client input needed]` (CLR-004). No account yet | Procedure and three-scope rule: VPS_RUNBOOK section 5, "Klaviyo private key". Yearly and whenever a handler leaves. Revoke the old key only after a test signup passes | No form shown. Never set the key until the double opt-in gate (SU-M1, DEC-118) is passed |
| P-03 | Google Analytics 4 (property and web stream) | `PUBLIC_GA4_MEASUREMENT_ID`, `PUBLIC_CONSENT_MODE` | Page and ecommerce events after consent | Client `[client input needed]` (CLR-004): give us Editor access | A public identifier; change only if the property changes | GA4 off. Malformed id is silently treated as unset (no warning today) |
| P-04 | Meta pixel (Business account) | `PUBLIC_META_PIXEL_ID` | Standard events after consent | Client `[client input needed]` (CLR-004) | As P-03 | Meta off |
| P-05 | Reviews provider (not chosen; Judge.me is the coded adapter) | `REVIEWS_PROVIDER`, `JUDGEME_PRIVATE_API_TOKEN` (never `PUBLIC_`), `JUDGEME_SHOP_DOMAIN` | Product reviews | Client `[client input needed]` (Q-011, CLR-005) | Dashboard location `UNVERIFIED` (RUNBOOKS 5.3). Check reviews load | No reviews section, no request, no rating markup. The coded names are in `.env.example`; the DEPLOYMENT "reserved" list is older than the adapter (see "Known drift") |
| P-06 | Live chat provider (**none can run**: Shopify Inbox blocked, B-34) | `PUBLIC_CHAT_PROVIDER`, `PUBLIC_CHAT_REQUIRES_CONSENT` | Chat call-outs | Client `[client input needed]` | n/a until a provider exists | No chat. Only a development-only fake exists |
| P-07 | Affirm / Shop Pay Installments | `PUBLIC_AFFIRM_PUBLIC_KEY` (reserved, read by no code) | Financing message slot (hidden until active, SD-11) | Client `[client input needed]` (CLR-007) | n/a | Slot stays hidden |
| P-08 | Shopify Payments, PayPal | none in our code | Payment types at checkout | Client; activated on the client's accounts (CLR-007) | Provider-side | Payment types unavailable at checkout |
| P-09 | Maps | `PUBLIC_MAPS_API_KEY` (reserved, read by no code; restrict by referrer) | Not built | Client `[client input needed]` | n/a | None today |
| P-10 | Local Extend mock | `EXTEND_MOCK_ACCESS_TOKEN`, `EXTEND_MOCK_STORE_ID` | Development and tests only | Developers | n/a | **Never on a server** `[verified]` (VPS_RUNBOOK 5.3) |

## 4. Secrets we generate (one per environment)

| # | Name | What it is | Rule | Rotation effect | If lost |
|---|---|---|---|---|---|
| G-01 | `SESSION_SECRET` | Signs the session cookie | At least 32 random characters in production, different per environment. Generate on the server: `openssl rand -base64 48` | Every shopper is signed out; whether carts survive is `UNVERIFIED` (RUNBOOKS 5.3). A value under 32 characters in production makes every request fail (HTTP 500) | Missing: every request fails. Regenerate and restart |
| G-02 | `DELIVERY_COOKIE_SECRET` | Signs the delivery ZIP cookie | At least 32 characters, **different from `SESSION_SECRET`** | Saved ZIPs stop verifying; shoppers re-enter the ZIP | In production the delivery status becomes `service-unavailable` and haul-away is blocked at checkout |
| G-03 | `GUEST_LOOKUP_KEY_SECRET` | **Not read by any code. Do not set it** (DEPLOYMENT, P6-14) | n/a | n/a | n/a |

## 5. Non-secret settings (kept here so nobody hunts for them)

These are not secrets but a wrong value breaks something quietly (DEPLOYMENT "Production readiness"). Changing any needs a restart.

| Name | Holder | Note |
|---|---|---|
| `PUBLIC_SITE_URL` | Developer who deploys | The live origin; canonical links and sitemap. Update at cutover |
| `PUBLIC_SUPPORT_PHONE` | Client's number `[client input needed]` | Or the Site settings entry in Shopify admin |
| `PUBLIC_NAV_MENU_HANDLE` | Developer, after the client builds the menu | Wrong handle silently shows the fixed navigation |
| `OFFER_CONFIG_JSON`, `OFFERS_ENABLED`, `PUBLIC_GIFT_PICKER_ENABLED` | Developer (developer-managed until P4-12) | Missing or invalid in production pauses checkout. The real rules are the client's (CLR-011) |
| `TRUSTED_CLIENT_IP_HEADER` | Whoever runs the host | `x-real-ip` on the VPS; **never `oxygen-buyer-ip` on the VPS**. Unset: every shopper shares one lookup allowance |
| `TRACKING_LINK_HOSTS` | Developer, only with carriers the client confirms | Optional |
| Node server settings `PORT`, `BIND_HOST`, `TRUST_PROXY`, `MAX_BODY_BYTES`, `SHUTDOWN_TIMEOUT_MS`, `CACHE_MAX_ENTRIES`, `CACHE_MAX_BYTES` | systemd unit, not the env file | Host settings; DEPLOYMENT "Node server settings" |

## 6. Hosting, domain and certificates

Interim plan (DEC-079): the owner deploys by hand to a VPS on our own Node server. The client has not confirmed the hosting (Q-003, B-06). Rows marked `[client input needed]` change if the client picks Oxygen or its own server.

| # | Item | Used for | Owner at handover | Where the credential lives | Rotation and renewal | If lost |
|---|---|---|---|---|---|---|
| H-01 | VPS provider account | The production host | `[client input needed]` (account is the client's under SOW option B; interim owner is the project owner) | Provider login in a password manager | Provider billing date `[client input needed]` | Site and sync go down. Rebuild from the repository, the filled env file and the `deploy/` templates (VPS_RUNBOOK "Backups") |
| H-02 | SSH access, user `deploy` | Builds and releases | Server owner | Public keys on the server; private keys on each person's machine. Password login disabled `[verified]` as plan | Remove keys of anyone who leaves | Lockout: use the provider console |
| H-03 | Service user `mattressfitness` | Runs the Node process | n/a | No login, no home | n/a | Service will not start |
| H-04 | `/etc/mattressfitness/env` | All storefront variables | Server owner | `root:root`, `0600`; encrypted backup of the values in the password manager | Edit and `sudo systemctl restart mattressfitness` | Rebuild from the password manager. Back up outside the server |
| H-05 | Domain registrar account | The shop's domain | Client `[client input needed]` (CLR-004) | Client's registrar login | **Domain expiry date `[client input needed]`**: set an alert 60 days ahead | The site goes offline when the domain lapses |
| H-06 | DNS host (registrar or other) | Records for the shop name | Client `[client input needed]` | Registrar or DNS provider login | See CUTOVER_AND_DNS | Site unreachable or mail misrouted |
| H-07 | TLS certificate (Let's Encrypt via certbot) | HTTPS | Server owner | `/etc/letsencrypt` on the server; certbot account e-mail `<EMAIL>` `[client input needed]` | Automatic: `certbot.timer`. Prove with `sudo certbot renew --dry-run`. Alert 21 days before expiry (VPS_RUNBOOK section 9). Certificates last about 90 days `[assumed]` | Browsers warn; reissue with certbot. Back up `/etc/letsencrypt` for speed (optional) |
| H-08 | Uptime and alert service | Site, TLS expiry, sync alerts | Owner's choice | Not chosen; nothing wired (DEPLOYMENT "Monitoring") | n/a | No one is told when the site is down |
| H-09 | Password manager | Holds every value above | Owner, then client | Its own master credential and recovery | Review members at each staff change | All secrets must be re-created at source |

## 7. Sign-off block (complete at handover)

| Item | Entry |
|---|---|
| Date of this inventory's last review | `[to fill]` |
| Reviewed by (us) | `[to fill]` |
| Accepted by (client decision-maker, Q-013) | `[client input needed]` |
| Accounts transferred or confirmed | list the row IDs: `[to fill]` |
| Rows that stay with us after handover (maintenance is separate, EXC-13) | `[to fill]` |
| Secrets replaced since staging (date, person; no values) | `[to fill]` |
| Repository history scanned for secrets before transfer (tool, date, result) | `[to fill]` (REQ-HAND-001; a dedicated scanner run once is a recommendation, not built) |

## Known drift to fix elsewhere (not edited here)

- [DEPLOYMENT](../deployment/DEPLOYMENT.md) says the root `.env.example` lacks `TRUSTED_CLIENT_IP_HEADER` and `TRACKING_LINK_HOSTS`, and lists reviews, Klaviyo and chat as "reserved, read by no code". On 2026-10-26 `.env.example` names them, and the reviews adapter, Klaviyo signup and chat adapter exist. The owner of DEPLOYMENT should update it.
- `deploy/mattressfitness.env.example` does not name the reviews, chat or analytics variables; add them when those features are switched on.

## What this inventory does not cover

Customer data held by Shopify and providers; staff accounts inside Shopify admin and each provider; payment-processor accounts beyond naming them; the maintenance agreement after handover (EXC-13); backups of the client's own mail. Whether any row's login must use 2-step verification is a client policy `[client input needed]`.
