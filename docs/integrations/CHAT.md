# Live chat (P7-03)

Requirement: REQ-ANL-004 (chat provider embedded behind an adapter, call-outs open it, consent and CSP handled). Also NFR-011 (consent), NFR-013 (a failing provider never blocks), NFR-003 (accessibility). Threats: T-10 (third-party scripts), T-05 (PII), T-16 (consent, legal). Open: Q-011 and CLR-005 (no provider is chosen or approved), V-24.

Status 2026-10-25: **the adapter, the registry, the consent gate, the call-outs and a development-only fake provider are built and unit-tested (see "Verified"). NO real provider can run: Shopify Inbox, the default named in REQ-ANL-004, is BLOCKED / UNVERIFIED on this storefront (next section), and no other provider is approved.** With `PUBLIC_CHAT_PROVIDER` unset (the default) chat does not exist: no code is requested, no script, no CSP host, no "Chat with us". Nothing here has been seen in a browser (`tests/e2e/chat.spec.ts` is written, not run).

## Shopify Inbox on this storefront: BLOCKED

Facts read from official sources on 2026-10-25, and what they do and do not say:

| Fact | Source |
|---|---|
| Hydrogen's July 30 2026 developer-preview notes list "Shopify Inbox support": shoppers chat with the store's AI agent and are handed to staff, without signing in. Inbox is enabled through `ShopifyScripts`; `<shopify-chat />` controls where the widget appears. The store needs the Inbox app with the **Agent** feature enabled and "Require sign-in to chat with staff" **off**. The `shop` option of `ShopifyScripts` must include `myshopifyDomain`. The notes give **no code, no script URL, no host and no CSP guidance**, and nothing Inbox-specific on consent. | https://hydrogen.shopify.dev/update/developer-preview-release-notes-july-30-2026 ; https://shopify.dev/changelog/hydrogen-developer-preview-update-july-30 |
| That support belongs to the new Hydrogen **developer preview**: installed with `npx @shopify/hydrogen@preview setup`, "a toolkit, not a framework", "the API will change", migration guidance "will come later", and "Current Hydrogen remains fully supported". It is a different line from the stable `@shopify/hydrogen` 2026.4.x with React Router 7 that this project is pinned to (ADR-0008). | https://hydrogen.shopify.dev/update/hydrogen-developer-preview |
| The Inbox help centre turns online-store chat on as a **theme app embed**: Online Store > Edit theme > App embeds > Online store chat. A headless storefront has no theme to carry that embed, and the help pages say nothing about headless, custom storefronts or Hydrogen. | https://help.shopify.com/en/manual/inbox/chat-settings-and-appearance/settings ; https://help.shopify.com/en/manual/inbox/setup |
| Shopify's own custom-storefront page says a custom storefront replaces the Online Store channel. | https://help.shopify.com/en/manual/custom-storefronts |
| The Hydrogen repository discussions (2023, 2024) have no official answer; one developer reported a script-tag workaround was "not stable". | https://github.com/Shopify/hydrogen/discussions/2036 |
| UNOFFICIAL: a Weaverse guide loads `https://cdn.shopify.com/shopifycloud/shopify_chat/storefront/shopifyChatV1.js?...` with abbreviated query parameters Shopify's loader consumes, from `PUBLIC_STORE_DOMAIN` and an Inbox shop id, and suggests `script-src https://cdn.shopify.com` and `connect-src https://*.shopifysvc.com`. It calls itself "a working reference, not a required component or stable Shopify API contract", says Shopify may change hosts, parameters and DOM without notice, and says **Shopify exposes no documented API to open the widget from a custom button**. | https://weaverse.io/docs/hydrogen-integrations/shopify-inbox |

What follows, and what is **not** done:

- Not implemented: no Shopify Inbox adapter, no script URL, no query string, no host in any policy. The URL above is from an unofficial source and its parameters are not documented; using it would be inventing an integration. `shopify-inbox` is refused at startup as `provider_blocked` (`chat.config_refused`, once per process, reason only).
- The REQ-ANL-004 criterion "call-outs open it" cannot be met for Inbox even in principle until Shopify documents a way to open the widget programmatically (`ChatProvider.open()` has nothing to call).
- Unblocking, in order of likelihood: (1) the client picks a provider that documents a browser API (`open`, hosts, CSP, consent behaviour) and gives sandbox access (CLR-005, Q-011, IR-17); (2) the project adopts the Hydrogen `@preview` line, a framework decision for the architect and the owner, not an integration change; (3) Shopify documents Inbox for headless storefronts on the stable line (V-24: re-check the Hydrogen docs). Escalated to the orchestrator.

## What is built

| Part | Where | Notes |
|---|---|---|
| Contract | `app/lib/chat/provider.ts` | `interface ChatProvider { id; load(): Promise<void>; open(): void; isReady(): boolean; unload?(): void }`. `load` is idempotent and rejects on failure; no retries inside an adapter |
| Configuration | `app/lib/chat/config.ts` | `PUBLIC_CHAT_PROVIDER`, `PUBLIC_CHAT_REQUIRES_CONSENT`; read in the root loader; public by design (carries no key) |
| Registry | `app/lib/chat/registry.ts` | id to adapter; today only the fake, behind `import.meta.env.DEV` |
| Controller | `app/lib/chat/controller.ts` | pure state machine: `waiting`, `loading`, `ready`, `failed`; timeout (10 s), single-flight, withdrawal, open-before-ready |
| Live singleton | `app/lib/chat/live.ts` | one controller per page, adopted by every remount (the analytics `live.ts` pattern) |
| Shell handle | `app/lib/chat/handle.ts` | the only chat state in the initial JavaScript (a published view and an open action) |
| View | `app/lib/chat/view.ts` | state to what the call-out renders and the polite message; fixed English text |
| CSP hosts | `app/lib/chat/hosts.ts`, `app/lib/security-headers.ts` | table is empty (no approved provider); plumbing tested with a synthetic provider |
| Fake provider | `app/lib/chat/providers/fake.ts` | development and tests only; a labelled panel, no network |
| UI | `app/components/chat/` | all lazy: `ChatEntry` (one chunk, requested only when the header holds a chat entry) holds `ChatShell` (the gate, no markup) and `ChatCallout` (the list item: button or link, plus the live region); `ChatRuntime` (controller, registry, adapter) is a second chunk requested after consent and idle |
| Wiring | `root.tsx`, `UtilityBar.tsx`, `MobileNav.tsx`, `lazyPanels.ts`, `LazyPanel.tsx`, `navigation.ts` | the loader resolves the config and `buildUtilityLinks` puts it on the `chat` entry of the utility links (`UtilityLink.chat`); the header bar renders that entry through `chatPanel` (the panels' lazy loader and failure boundary) and the menu through its own lazy import of the same chunk; `LazyBoundary`'s `loading` and `failed` became optional (default none). `PageLayout` and the root component are untouched |

## Configuration

| Variable | Effect |
|---|---|
| `PUBLIC_CHAT_PROVIDER` | Unset or blank: **chat off** (no code, request, host or call-out). `fake`: the development fake, **dev server only**. `shopify-inbox`: refused, blocked. Anything else: refused as unknown. Exact match, no case folding |
| `PUBLIC_CHAT_REQUIRES_CONSENT` | Default **true**. Only the exact text `false` removes the consent wait. Whether the client may do that is a legal decision (Q-012, T-16) |

A refusal is logged once per reason (`chat.config_refused`, reason word only, never the value) and chat stays off. `fake` is refused when `import.meta.env.DEV` is false, **and** the production build does not contain the fake at all (searched: no `fake-chat-panel` or `__CHAT_FAKE__` in `dist/`, 2026-10-25).

## Consent decision (needs the client's counsel; not made here)

A chat widget is a third-party service that normally sets identifiers and talks to the vendor. The project's consent layer has two categories (`analytics`, `marketing`, `consent.ts`); adding a third, "functional", changes the stored choice, the banner wording and the policy version, which is a legal decision, so **it is not done**. Chosen instead, as a switch:

- `PUBLIC_CHAT_REQUIRES_CONSENT` (default true): the widget loads only after the shopper has allowed the **`analytics`** category, read from the consent layer's published store. The `marketing` category does not count (tested).
- **Consequence to read:** the banner offers the `analytics` checkbox only when `PUBLIC_GA4_MEASUREMENT_ID` is set. With consent required and no GA4 id, a shopper has no way to agree, so chat stays off and the loader logs `chat.config_refused` with `needs_consent_category`. A Meta-only store therefore cannot show chat while consent is required. Setting `PUBLIC_CHAT_REQUIRES_CONSENT=false` is the other route and needs the legal decision first.
- Wording: the banner says nothing about chat. If chat rides on the analytics checkbox, the banner copy and the privacy policy must say so (counsel). A dedicated `chat` category is the cleaner answer and is a recommendation, not a change made here.
- Withdrawal: the controller calls the adapter's `unload()` and hides the call-out. An adapter with no `unload` is reported (`chat.provider_failed`, `unload_unsupported`) and its widget could stay on the page: **a real adapter must implement `unload` before it is accepted on a consent-gated store.**
- No PII is sent by our code: the adapter contract has no argument for shopper data, `open()` takes nothing, and no cart, email, ZIP or order id is passed. What the vendor's own script collects is the vendor's (privacy policy, DPA: counsel).

## Loading and failure rules

1. Nothing for a store with no provider: the loader gives the utility links no `chat` entry, so `UtilityBar` and the menu never request the `ChatEntry` chunk and nothing else of chat exists in any route (unit-tested: `chat-gate-none.test.tsx`; the build contains the chat chunks only as lazy files that no route preloads). The initial JavaScript carries only the header's chat branch and one `createLazyPanel` call (measured below).
2. With a provider: the header bar requests `ChatEntry` at render (a small chunk, no vendor code, no vendor request; it is the only chat file fetched before consent). Its gate then requests `ChatRuntime` when the browser is idle after hydration and, with consent required, only after the shopper allows `analytics`. Until then no controller, adapter, script or vendor request exists. The gate's idle helper and the consent handle are not imported by the chunk (the handle arrives as a prop, the idle helper is a local copy): importing the analytics gate from the lazy chunk made it a shared chunk that every route downloaded (measured: one more file, about 170 bytes on every route).
3. The runtime stays mounted afterwards so a later withdrawal reaches it. A fresh grant after a withdrawal or a failure tries once more; there is no retry timer.
4. Failure (adapter missing, rejected load, 10 s timeout, not ready, throwing `open` or `unload`) hides chat only. One line `chat.provider_failed` with provider and a fixed reason word (`create_failed`, `load_failed`, `load_timeout`, `not_ready`, `open_threw`, `unload_unsupported`, `unload_threw`), written to the shopper's browser console like the analytics line. A `ChatEntry` chunk that cannot be downloaded is caught by the panels' failure boundary and shows nothing; a `ChatRuntime` chunk that cannot be downloaded writes `chat.chunk_failed` (NFR-013). There is no log line for a failed `ChatEntry` download (the shared panel boundary does not log; adding one would cost initial JavaScript).

## Call-outs and accessibility

- **Where:** the header utility bar (from 1024 px) and the mobile menu's "Help and contact" list, from the one `chat` entry in `buildUtilityLinks` (present only when a provider is configured). The home "store and chat call-outs" (REQ-HOME-001) and the contact page are not wired: the home blocks are content from Shopify admin and the contact page text is the client's; `ChatCallout` is exported for a support tile when the design needs one. No PDP or cart help link exists in the plan.
- **A real button**, name "Chat with us", with the chat icon decorative. The list item exists only while the widget is `loading` or `ready` (or after a press that failed), so there is never a button with nothing behind it.
- **Before ready:** pressing it records the request, sets `aria-busy`, and a polite live region (`role="status"`, inside the same list item, so it exists whenever the call-out does and its text change is read out) says "Starting chat."; the widget opens the moment it is ready. The header bar's live region is not announced on a phone (the bar is hidden below 1024 px); the menu's instance, in the open drawer, is the one that speaks there.
- **On failure after a press:** the live region says "Chat is unavailable right now." and the button is replaced by a link "Chat unavailable: contact us" to `/pages/contact` **only if that page exists** (the root loader's existence rule; the contact link in the list is the signal); focus moves to the link. With no contact page the call-out simply goes away. A failure nobody asked about is silent and leaves nothing (no empty list item).
- **A throwing `open`:** "Chat could not be opened. Please try again." and the button stays.
- **Focus return and motion:** for the fake, the panel takes focus, Escape or Close returns it to the opener. For a real widget, focus handling and animation are the vendor's: UNVERIFIED. Our code adds no animation, so `prefers-reduced-motion` needs nothing from us. On the phone the menu drawer closes first, then the widget opens; whether the drawer's focus return fights the widget's focus is UNVERIFIED in a browser.
- The text "Chat with us" is fixed in code. It is a button, not content from Shopify admin.

## Content Security Policy (T-10)

`app/lib/chat/hosts.ts` is the one place for a provider's documented hosts (script, image, connect, frame). **It is empty**: the fake loads nothing external and no real provider is approved. `security-headers.ts` accepts the configured provider's hosts for both policies (`buildReportOnlyCsp({chat})`, `enforcedCspExtras(analytics, chat)`) with parity (tested with a synthetic provider), repeats Hydrogen's Shopify sources where it names a directive, and replaces `frame-src 'none'` only when a provider names a frame host. With no chat hosts both policies are byte-for-byte unchanged (tested).

**Wired in `entry.server.tsx`** (2026-10-25, after the content developer finished): `parseChatConfig` with the same options as the loader, `chatCspHosts(providerId)`, then `enforcedCspExtras(analyticsCsp, chatCsp)` and `chat: chatCsp` in `buildReportOnlyCsp`. It changes nothing today (the table is empty). The first real adapter adds its hosts in the same change. `docs/security/SECURITY_HEADERS.md` ("Rule for adding any other provider") applies: exact documented hosts, no wildcard, no `unsafe-inline`, report-only first, a DECISIONS line.

## Adding a provider (checklist)

1. The client chooses (CLR-005, Q-011) and gives sandbox access (IR-17); read the vendor's docs for: how the widget loads, whether it can be opened and closed from code, its hosts, cookies, consent behaviour, how to remove it.
2. Add the id to `CHAT_PROVIDER_IDS` (`config.ts`), an adapter in `app/lib/chat/providers/` implementing `ChatProvider` (with `unload`), a line in `registry.ts` and its hosts, with source URL and date, in `hosts.ts`. Unit-test load, failure, open, unload.
3. If the vendor cannot be opened from code, the call-out has nothing to call: say so here and do not fake it.
4. Update this file, `INTEGRATION_CONTRACTS.md`, `READINESS_CHECKLIST.md` (IR-17), `SECURITY_HEADERS.md`, and run `tests/e2e/chat.spec.ts` against the provider's sandbox.

## Verified and not verified

Verified (2026-10-25): 84 unit tests in 7 files (`storefront/tests/unit/chat/**`), plus the 48 existing CSP tests (`tests/unit/analytics/csp.test.ts`, `app/lib/security-headers.test.ts`) unchanged and passing; the full unit suite 243 files, 6279 tests, passing; typecheck, ESLint and Prettier clean on every touched file; `npm run build` and `npm run perf:bundle` pass. Covered: configuration parsing (hostile values, fake outside development, blocked Inbox, strict consent switch, once-per-reason logging); the controller (load, timeout, rejection, missing adapter, not ready, throwing sink, silent versus announced failure, retry only on a new grant, open before ready exactly once, throwing open, withdrawal before, during and after the load, an overtaken load not tearing down a newer one, no `unload`, throwing `unload`, `stop`); the registry and the fake (idempotent load, failure and delay controls with bounds, focus return on close and Escape, unload); the UI in jsdom with the real lazy chunk (nothing before consent, `marketing` is not consent, call-out after consent and idle, withdrawal removes the widget and the button, consent not required, real button and name, focus in and back, busy and starting message, failure swap with focus kept, no dead link without a contact page, StrictMode and remount adoption, the header bar renders a button and no empty items, a chat entry without a configuration renders nothing); CSP plumbing and parity; navigation. A production build contains neither the fake nor the config strings in client files.

**UNVERIFIED / not done:**

- Everything in a browser: the call-out in the header and the menu, layout shift when the call-out appears after idle (it adds a right-hand item to the utility bar; measure CLS), focus with the drawer, axe with the widget open (`chat.spec.ts` written, not run).
- Any real provider: hosts, CSP, `open()`, cookies, `unload`, focus, motion, the vendor's consent behaviour.
- Shopify Inbox in every respect (above).
- Chat in a browser with a configured provider: server rendering of the lazy header entry (it renders nothing on the server because the controller's view starts hidden, but the chunk is awaited by the streamed render) is unit-tested only in jsdom.
- Legal sufficiency of gating chat on the `analytics` category (Q-012, T-16).

## Bundle cost (scripts/perf, DEC-100, DEC-101), measured 2026-10-25

Rule: with chat off (the default) the shell must cost almost nothing in the initial JavaScript. Method: `git archive HEAD` into a scratch copy outside the repository (node_modules junctioned), then `npm run build` and `npm run perf:bundle` there for the "before"; the same two commands in the working tree for the "after". Gzip headroom against the unchanged budgets, in bytes:

| Route | Before (HEAD, no chat) | First version of this task | After the cut |
|---|---|---|---|
| home | 1159 | 389 | 1084 |
| collections.$handle | 1604 | 836 | 1529 |
| collections.all | 1629 | 861 | 1554 |
| products.$handle | 1324 | 557 | 1249 |
| cart | 1358 | 594 | 1283 |
| checkout-steps | 1197 | 429 | 1122 |
| search | 1250 | 482 | 1175 |
| quiz._index | 1242 | 473 | 1167 |
| compare | 1244 | 476 | 1169 |
| brands.$handle | 1282 | 515 | 1207 |
| brands._index | 1443 | 677 | 1368 |
| stores._index | 1582 | 814 | 1507 |
| stores.$state.$city.$slug | 1469 | 700 | 1394 |
| account | 1426 | 658 | 1351 |
| account.orders._index | 1360 | 592 | 1285 |
| pages.$handle | 1851 | 1082 | 1776 |
| policies.$handle | 1853 | 1084 | 1778 |
| blogs._index | 1996 | 1229 | 1921 |
| blogs.$blogHandle._index | 1998 | 1230 | 1923 |
| blogs.$blogHandle.$articleHandle | 1844 | 1077 | 1769 |

The first version cost about 770 bytes on every route: a gate component and a call-out chunk in the initial graph, and a shared chunk that also swept up `NavAnchor`, the handle and the call-out. The cut: nothing chat-shaped is imported by the initial JavaScript except the header's chat branch and one `createLazyPanel` call; the gate, the live region, the call-out and the handle are one lazy chunk (`ChatEntry`); the config rides on the `chat` utility link, so `PageLayout` and the root component carry nothing; the file count per route equals the baseline. **The remaining cost is 75 bytes on every route.** Every route is at or above 1122 bytes except **home, at 1084: 16 bytes under the 1100 target** (75 under its 1159 before). What is left is the header branch, the lazy loader call and the preload-map entry for `ChatEntry`; the map is Vite's, and removing it needs `build.modulePreload` configuration in `vite.config.ts`, outside this task. Budgets were not edited.
