# Security review: Klaviyo email and text-message signup (P7-02, REQ-ANL-003)

Date: 2026-10-25. Reviewer: security-engineer. Read-only review of the **uncommitted working tree** on branch `feat/content-pages-and-signup` (HEAD `f50cd27`). No browser, no call to Klaviyo (no account, key or list exists, CLR-004), no nginx. The only file written is this note. Scope: `storefront/app/routes/signup.tsx`, `app/lib/signup/**`, `app/components/signup/**`, `tests/unit/signup/**`, `tests/unit/routes/signup-route.test.ts`, `tests/e2e/signup.spec.ts`, `docs/integrations/KLAVIYO.md`, and the mounting edits in `root.tsx`, `PageLayout.tsx`, `SiteFooter.tsx`, `HomeSections.tsx`, `routes/_index.tsx`, `env.d.ts`, `.env.example`. The content-page edits in the same files were ignored. Threats: T-04, T-05, T-08, T-10, T-13, T-16 (also T-12 dependencies).

## Verdict

**PASS WITH CONDITIONS. No High.** The code is inert until `KLAVIYO_PRIVATE_API_KEY` and `KLAVIYO_LIST_ID` are both set, so merging it exposes nothing. Three Medium findings must be closed (or accepted in writing by the owner) **before a real key is set on a public host**:

- **SU-M1 (Medium):** the Subscribe Profiles call removes unsubscribe, spam-report and suppression states. Double opt-in on the list is the only control, the code cannot see it, and nobody has observed the behaviour.
- **SU-M2 (Medium):** the form can be used to send confirmation mail from the client's brand to other people's inboxes. The ceilings (300 per 15 minutes overall) are high for a small store, the only bot control is a honeypot, and `/signup` has no host-level rate-limit zone.
- **SU-M3 (Medium, inert while SMS is off):** the optional SMS field has no proof that the person owns the number and no per-number limit. It stays off in production because `SMS_CONSENT.clientApproved` is false; keep it that way until fixed.

Five Low and several Info items below. What was checked and found sound: server-only key handling (no private name in `dist/client`), fixed host and refused redirects, no header injection, strict ASCII email parsing, E.164 output, separate SMS consent, uniform answers, no PII in logs, Klaviyo error bodies never read, same-origin check, `no-store` headers.

## Method and evidence

Read in full: `CLAUDE.md`, `.claude/rules/security.md`, `docs/integrations/KLAVIYO.md`, `GUEST_TRACKING.md` (limiter pattern), the THREAT_MODEL rows, `handler.ts`, `klaviyo-client.ts`, `limiter.ts`, `email.ts`, `request.ts`, `config.ts`, `consent.ts`, `shared.ts`, `precheck.ts`, `routes/signup.tsx`, `SignupForm.tsx`, `SignupSlot.tsx`, plus the shared pieces they reuse: `delivery-runtime/form.ts`, `cart/http.ts` (`isSameOriginRequest`), `orders/guest-lookup-address.ts`, `orders/guest-lookup-limiter.ts`, `stores/directions.ts` (`normalizeUsPhone`), `logging/logger.ts`, `deploy/nginx.conf.example`, and the diffs of the mounting files.

Ran (real results, 2026-10-25, Node 22.23.3):

| Check | Result |
|---|---|
| `vitest run tests/unit/signup tests/unit/routes/signup-route.test.ts` | 8 files, 249 tests, pass (the author's tests; they are a typed fake, not Klaviyo) |
| `grep -rlE "KLAVIYO\|klaviyo" dist/client` on the existing build (server bundle built 13:05, contains the signup code) | no match in the client output; the names appear only in `dist/server/index.js` and its map. `SignupForm-*.js` is a separate lazy chunk containing `company_website` and no server module |
| Client imports of `app/lib/signup/*` | `SignupForm.tsx` imports only `consent`, `precheck` (which imports `email`) and `shared` (all pure, no env, no key). `root.tsx` imports `config.ts` for the loader; it is stripped from the client build (confirmed by the grep above) and holds names only anyway |
| Key-shaped string scan over every changed or new file (`pk_...`, `Klaviyo-API-Key <value>`, `sk_live_`, 32+ character tokens) | only two SHA-256 hashes of consent sentences in a test; no secret. `.env` files not read. `.env.example` holds names only |
| `npm audit --omit=dev` | 7 vulnerabilities (1 low, 4 moderate, 2 high), unchanged from the earlier reviews (ADR-0008, H-1). No dependency added: `package.json` unchanged; `package-lock.json` diff only removes `"dev": true` from lightningcss platform binaries (Info SU-I6) |
| Klaviyo documentation (WebFetch, untrusted data, read 2026-10-25) | Subscribe Profiles, Create Client Subscription, Get Profile, Get List and the consent guide; quoted where used below |

Not run by me: the Playwright spec (written, never run), any browser, any real Klaviyo call.

## Answers to the author's questions

### 1. Private key with `lists:write` on the storefront host: acceptable, with conditions (SU-L1)

Yes. Reasons:

- Klaviyo documents Subscribe Profiles as the server endpoint and says of the browser endpoint: "Do not use this endpoint from server-side applications" (create_client_subscription reference). The author's deviation is correct.
- The three scopes are the ones Subscribe Profiles names (`lists:write`, `profiles:write`, `subscriptions:write`). **None is a read scope**, so a leaked key cannot read a single customer record or list membership. The loss from a leak is integrity and abuse, not confidentiality.
- The private-key route is the stronger one against abuse. With the browser endpoint the company id is public by design and the endpoint is reachable by anyone directly (350/s burst), so a server-side limiter and honeypot would protect only a door nobody has to use. With the private key, **our server is the only door**, which makes the limiter in `limiter.ts` worth having. (Note the account's public endpoint still exists for anyone who learns the company id and list id; double opt-in on the list covers both paths. Not verified how discoverable those ids are.)
- The worst case on leak: `subscriptions:write` with `historical_import: true` and a past `consented_at` "will bypass double opt-in" (Subscribe Profiles reference). An attacker with the key could subscribe arbitrary addresses to the client's lists without confirmation, and `lists:write` could alter lists. Consequence: spam to non-consenting people, sender-reputation and account suspension, CAN-SPAM/TCPA exposure. Treat the key accordingly.

Conditions (SU-L1): create a **custom** key with exactly the three scopes (Klaviyo: "you cannot add a scope to an existing private key"; delete and recreate if one is missing); never reuse it for anything else and never grant a read scope to it; set it only in the server environment (systemd `EnvironmentFile`, `0600`, not in the repository, never `PUBLIC_`); record a rotation procedure and owner in the runbook; do not put it in `dist`, CI logs or the handover bundle (history scan REQ-HAND-001); alert when Klaviyo shows jobs the storefront did not make (client-side Klaviyo audit). No intermediary is needed.

### 2. Per-mailbox counter and victim lock-out

**Partly enough.** What it does: at most 3 attempts per normalised mailbox per hour (`limiter.ts:41`, `:119-126`; `+tag` and Gmail dots and `googlemail.com` collapsed in `email.ts:53-63`), and a refused attempt is recorded nowhere (atomic `reserve`, `guest-lookup-limiter.ts:122-145`), so an attacker blocked by address or overall counters cannot burn the victim's allowance. That caps what one mailbox receives through this path at about 72 confirmations per day. It does not cap the total mail the brand sends (SU-M2) and does not collapse every alias (SU-L3).

**Victim lock-out: acceptable (SU-L2), propose owner acceptance.** Anyone can make three requests with fresh addresses and hold a mailbox's signup shut for an hour. The cost to the victim is waiting an hour for a non-critical marketing signup; the 429 message is the same for every counter. Same trade-off class as the guest-tracking lock-out (L-2). Needs the owner's written acceptance; I have not recorded one.

### 3. Re-subscription of opted-out profiles: double opt-in is the right control but is not yet verified or verifiable by the code (SU-M1)

Official text, quoted: "This API will remove any `UNSUBSCRIBE`, `SPAM_REPORT` or `USER_SUPPRESSED` suppressions from the provided profiles." and "If the provided list has double opt-in enabled, profiles will receive a message requiring their confirmation before subscribing. Otherwise, profiles will be immediately subscribed without receiving a confirmation message." The page does not say whether an unsubscribed profile becomes subscribed, nor whether the suppression is cleared before or after the confirmation. **Both are unverified.**

Options considered:

| Option | Assessment |
|---|---|
| A. Double opt-in on the list | **Recommended, mandatory.** The only documented control. It means a third party who types a stranger's address cannot make that person marketable; they can only cause one confirmation message. Residual: that message reaches someone who unsubscribed (bounded by the counters) |
| B. Pre-check with Get Profiles (`additional-fields[profile]=subscriptions` shows `email.marketing.suppression` reasons such as `UNSUBSCRIBE`) and skip suppressed profiles | **Not recommended on the runtime key.** Needs `profiles:read`, which turns a leaked key into a customer-data leak (the opposite of the property in answer 1). Also an extra call and a race, and it would silently ignore a genuine returning subscriber. If the owner wants it, use a separate narrowly scoped path, not this key |
| C. Different endpoint | The client endpoint's page says nothing about suppressions; **do not assume it behaves differently**. It is also forbidden from servers |
| D. A Klaviyo setting that blocks API re-subscription | none found in the documentation read; unverified |

Verifiability: `GET /api/lists/{id}` returns `opt_in_process` ("Valid values: 'double_opt_in', 'single_opt_in'", scope `lists:read`). So the setting **can** be checked by a one-off go-live script or by hand in the Klaviyo interface using a short-lived read-only key created for the check and then deleted. Do not add `lists:read` to the runtime key (small gain, and the setting can be changed in the interface at any time, so a startup check is not a guarantee either).

Required evidence before go-live (add to V-22): (1) the list's `opt_in_process` observed as `double_opt_in`; (2) in a Klaviyo sandbox or test account, unsubscribe a test profile, call the signup for it, and record that the profile is **not** marketable until the confirmation is clicked and that the unsubscribe state is not silently lost; (3) record who may change the list setting and add a periodic re-check (detective control). Without (1) and (2) the verdict for this item is fail.

### 4. 4 KB cap, no CAPTCHA, per-instance counters until P6-14

- **4 KB cap: fine.** `form.ts:5,19-25,35-38` refuses a wrong content type and an over-size declared or streamed body before buffering; the form is a few hundred bytes. nginx also caps at 1 MB. A JSON body is refused (`FORM_TYPE`), confirmed by the handler test.
- **No CAPTCHA: acceptable for development and staging, not enough on its own for a public URL** (SU-M2). The honeypot (`request.ts:51`) stops only form-filling bots, and the field name is in the public JavaScript chunk. Cheapest next step that adds no third party: lower ceilings, a host zone, an alert. If abuse appears, a signed form-age token or a proof of work; Cloudflare Turnstile or similar adds a script origin (T-10: CSP `script-src`/`frame-src`, owner approval) and is the strongest option.
- **Per-instance counters: acceptable on the single VPS process only** (T-13 already has this caveat for guest lookup). They reset on restart, and on Oxygen each isolate has its own memory, which would make the limiter close to void. Do not deploy signup on Oxygen or more than one process before P6-14 (add to the P6-14 scope and to the deployment checklist).

### 5. T-05: confirmed

- `custom_source` is built by `consentSource` (`handler.ts:88-91`) from `input.surface` (allow-list `footer|home`, `request.ts:57`, `shared.ts:5-10`), `input.emailConsentVersion` (must equal `EMAIL_CONSENT.version`, `request.ts:57,96`) and `input.sms.consentVersion` (constant, `request.ts:84`). Fixed text, no shopper-controlled string. A test pins it.
- The generic answer (`shared.ts:57`) and every error string are constants; nothing the shopper typed is echoed (the hostile-input test confirms for 8 payloads).
- `klaviyo-client.ts:153` cancels the response body and only `response.status` is read (`:154`); `Retry-After` and `X-Klaviyo-Partial-Failure` are not read either. The `catch` at `:158` discards the thrown error, so no message can reach a log. Log fields in `handler.ts` are event names, reason codes, counts, `clientSource`, `consentVersion` only (lines 98, 106, 110, 130, 133-137, 146, 157, 161-164, 181-184, 187-192); the logger redacts in addition (`logger.ts:43`). A handler test that throws an error containing an address confirms it is not logged.
- The address and phone go to Klaviyo by design: the privacy policy must name Klaviyo and what is sent (T-16, open Q-021).

## Findings

### Medium

**SU-M1. Re-subscription of opted-out people depends on a list setting nobody has seen (T-16, T-05 privacy, R1 in KLAVIYO.md §6)**
Evidence: Klaviyo text quoted in answer 3; `klaviyo-client.ts:79-112` sends `SUBSCRIBED` for the typed address with no knowledge of its current state; `KLAVIYO.md:18,73` records the risk and the condition; the code cannot check it. Impact: on a single opt-in list anyone can re-subscribe a person who unsubscribed or reported spam, and re-enable sending to a spam complainant. Fix: no code change; the evidence in answer 3 as a go-live gate (V-22, `progress/BLOCKERS.md`), a runbook line naming the owner of the list setting, a periodic re-check. Also state in the privacy policy that the person receives a confirmation message.

**SU-M2. Confirmation-mail abuse ceiling is high and the bot controls are thin (T-13, T-16, brand/deliverability)**
Evidence: `limiter.ts:38-43` allows 6 per client address per 15 minutes, 300 overall per 15 minutes (1,200 per hour, 28,800 per day, each potentially a confirmation email to a different stranger, from the client's sending domain); an attacker rotating addresses (IPv4 botnet, or IPv6 /64s) is bounded only by the overall figure; the only bot control is the honeypot (`request.ts:51`); `deploy/nginx.conf.example:59-63,244-252` has zones for lookup, cart, offers and webhooks but **none for `POST /signup`** (only `mf_general` at 20 r/s); counters are per process (`handler.ts:236-248`); `TRUSTED_CLIENT_IP_HEADER` unset puts everyone in one bucket (`limiter.ts:105-117`). Unverified: whether Klaviyo re-sends a confirmation for an address that is already pending. Impact: spam complaints and bounces against the client's sending domain, a Klaviyo account warning or suspension, harassment of a third party. Fixes (in order of value): (1) set the overall ceiling to what a small store needs (suggest 60 per 15 minutes, alert on `signup.rate_limited` with `limitedBy=overall`), and an additional per-address daily cap; (2) a `mf_signup` zone keyed like `$mf_key_lookup` (`POST /signup` and `POST /signup.data`, devops file), plus `nginx -t` (B-19); (3) record in the runbook how to switch the form off fast (unset the key; the form disappears and POST answers 503); (4) watch Klaviyo bounce and complaint rates after launch; (5) if abuse appears, a signed form-age token or Turnstile (owner decision, T-10). Residual after 1 to 4: a determined distributed attacker can still send hundreds of confirmation emails per hour; propose the owner accepts that with double opt-in in place (no consent is created by those mails).

**SU-M3. SMS: no proof of number ownership and no per-number limit (T-16, T-13; inert in production)**
Evidence: `request.ts:72-85` accepts any valid NANP number with a ticked box; `limiter.ts:119-126` counts the email only, never the phone; the Subscribe request marks the SMS channel `SUBSCRIBED` (`klaviyo-client.ts:100-102`). `config.ts:52-60` keeps SMS off in a production build while `SMS_CONSENT.clientApproved` is false (`consent.ts:40`), so there is no live exposure. Impact if enabled as is: anyone can enrol a stranger's phone (varying the email to dodge the mailbox counter), exposing the client to unwanted texts, carrier filtering and TCPA claims. Fix before enabling: a per-number counter (hash of the E.164 number, 3 per hour, in `limiter.ts`); counsel's decision on number verification (Klaviyo SMS confirmation by reply, or a code); keep `clientApproved: false` until both are in. Unverified: what Klaviyo sends when a phone is subscribed through this endpoint.

### Low

**SU-L1. Key blast radius and handling (T-04)**: see answer 1. Accept with the stated conditions; add to the runbook and to `docs/deployment` environment table. Not a defect in the code: `config.ts:48` validates only a printable-ASCII shape (so CRLF cannot enter the `Authorization` header), the key lives in a closure (`klaviyo-client.ts:123-168`) and appears in no log or result.

**SU-L2. Lock-outs (T-13)**: a victim's mailbox can be locked for an hour (answer 2), and with `TRUSTED_CLIENT_IP_HEADER` unset any one visitor can use the whole form's shared allowance of 60 per 15 minutes (`limiter.ts:39,105-117`), shutting it for everyone. Availability of a marketing form only; accept. Fix for the second: set the header on the host (condition 3 in KLAVIYO.md; N-1 startup warning is already with devops).

**SU-L3. Mailbox collapsing is incomplete (T-13)**: only `+tag` (any domain) and Gmail dots (`email.ts:53-63`) are collapsed. Not collapsed: Yahoo-style `-` extensions, catch-all domains (`a1@victim.example`, `a2@...` are different mailboxes to the limiter and the same inbox to the victim), other providers that ignore dots (unverified which). Fix (optional): a per-domain counter (for example 10 per hour) with an exemption list of large providers. Also note a request with a valid address is counted even if it is later refused for missing consent or a filled honeypot (`handler.ts:117-127`, `emailIfValid` `:223-232`): intentional and harmless, but it makes the lock-out cheaper (3 junk posts).

**SU-L4. Every signup post revalidates the root loader and the page loader (T-13 cost)**: `root.tsx:61` returns true for any non-GET fetcher submit, so each `fetcher.Form` post to `/signup` (including 422, 429 and 503 answers) re-runs the root loader (navigation, footer links, cart, delivery) and the page's loader. It is driven only by real browsers (a bot using curl does not trigger it), so the effect is wasted Shopify reads and a layout re-render per signup. Fix: in `shouldRevalidate`, return false when `formAction` is `/signup` (check the exact value React Router passes); the root `signup` field is static per deployment and needs no refresh. It exposes nothing private: the loader field is `{sms, privacyHref}` or `null` (`config.ts:82-89`), no key, list id or env.

**SU-L5. Consent evidence is thin (T-16)**: Klaviyo gets its own timestamp and `custom_source` (surface and version); the sentence is traced by version and git history (KLAVIYO.md §5). No IP or user agent is recorded, which is a privacy plus, but counsel must confirm it is enough for email and, above all, for SMS (Q-012, Q-015). Open, not a code defect.

### Info

- **SU-I1 (timing and oracles)**: a honeypot hit returns at once while a real signup waits for Klaviyo, so a bot can tell the trap from success by latency; harmless (the bot learns the trap, not an address). New and known addresses both get Klaviyo's 202 and one message, so no enumeration on the happy path. Two small oracles, both accepted: a 429 shows that a mailbox was tried several times recently by someone; a Klaviyo 4xx (`rejected`, 422 "could not sign you up") says Klaviyo refused something about the request. Which addresses trigger a Klaviyo 4xx is unverified.
- **SU-I2 (host and redirects)**: the host is a constant (`klaviyo-client.ts:23-29`); `isAllowedKlaviyoUrl` is checked against that same constant so it cannot fail today, but guards a future edit; `redirect: 'error'` (`:150`), 6 s timeout (`:136-139`, covers headers and body, body cancelled), one attempt, no retry. No user input reaches the URL, the headers or a path: the address and phone are only values inside `JSON.stringify` (`:148`), so there is no SSRF, header or JSON injection path. CRLF in an address is refused by the ASCII range check (`email.ts:31`) and the handler test.
- **SU-I3 (email and phone parsing)**: ASCII only, one `@`, atext local part up to 64, dotted domain with a letters-or-punycode last label, 254 total, trim then lower-case (`email.ts:26-47`); no quoted local parts, comments, IP-literal domains, raw Unicode, trailing dot or empty labels; both regexes are linear (the atom class excludes the dot). The first of duplicate `email` fields is the one validated, counted and sent. Raw-Unicode IDN domains are refused (a usability limit; punycode is accepted). Phone: `normalizeUsPhone` allows digits and `()+-. ` only, `+` only as a leading `+1`, 10 digits with NANP rules, output `+1XXXXXXXXXX` (`directions.ts:54-67`), valid E.164. It does not exclude N11 area codes or premium-rate prefixes (900/976); acceptable. A valid email with a phone Klaviyo rejects succeeds silently (`X-Klaviyo-Partial-Failure` is not read), so a shopper may think text signup worked.
- **SU-I4 (request guards)**: POST only (`handler.ts:97`); `isSameOriginRequest` refuses a foreign or `null` Origin and a `cross-site` Fetch Metadata (`http.ts:40-54`); a request with no Origin and no Fetch Metadata is allowed (curl), which is why the origin check is a CSRF guard and not a bot control. `Sec-Fetch-Site: same-site` passes (a sibling subdomain could post; none planned). The check compares hosts, so its behaviour behind nginx is the existing open item P-L5. No `Access-Control-*` header is set anywhere in `app/` (count 0), so no cross-origin browser read of the answer. Form content types only; no cookie is read or set; no state-changing GET (GET is a 405 page that reads nothing, `signup.tsx:32-38`).
- **SU-I5 (headers, errors, cache)**: answers carry `Cache-Control: private, no-store`, `Vary: Cookie`, `X-Robots-Tag: noindex, nofollow` (`handler.ts:72-75`, `private-response.ts:4-7`); the route `headers` export merges them with the action's `Retry-After`/`Allow` (`signup.tsx:25-30`). The handler never throws for expected failures; an unexpected exception would reach the root ErrorBoundary, which shows detail only in development (`root.tsx:339`). No CSP change is needed: the browser never calls Klaviyo and `form-action 'self'` covers the post. A document POST (no JavaScript) is answered in place and a reload re-posts after the browser's own prompt; the limiter bounds that.
- **SU-I6 (lockfile)**: `package-lock.json` loses `"dev": true` on the lightningcss platform binaries. No package was added or changed; regenerate the lockfile from the held toolchain before committing so the diff is not an accident of the author's machine.
- **SU-I7 (limiter memory)**: the in-memory store forgets least-recently-used keys beyond 5,000 per scope (`guest-lookup-limiter.ts:90`). A flood of distinct mailboxes could in principle evict a victim's counter, but the overall counter (300 per 15 minutes) makes 5,000 distinct recorded mailboxes in an hour unreachable. If SU-M2 is relaxed or the overall ceiling raised, revisit this.
- **SU-I8 (root revalidation and the `signup` field)**: see SU-L4. The root `signup` value reaches every page's data and tells a visitor that signup is configured and whether SMS is on; nothing private.

## Mapping to the checklist the author named

| Item | Result |
|---|---|
| SSRF and host allow-list, redirect refusal, timeouts | Verified in code (SU-I2) |
| Header injection (CRLF) and email edge cases | Verified in code and by the author's 8 hostile payloads (SU-I2, SU-I3) |
| SMS E.164 and consent separation | E.164 verified; separate box, separate version, ignored when off (SU-I3); ownership gap SU-M3 |
| Honeypot behaviour | Same thank-you, no side effect, one timing difference (SU-I1) |
| Response uniformity new vs existing | Uniform by design; depends on Klaviyo's 202 being the same, unverified |
| CSRF/origin, CORS, content type | SU-I4 |
| Log redaction | Verified (answer 5) |
| Private key not reaching the client | Verified: no name in `dist/client`; no client import of `config.ts`, `handler.ts` or `klaviyo-client.ts`; `env.d.ts` is types only |
| Error pages, caching headers | SU-I5 |
| Root loader `signup` field, revalidation side effect | SU-I8, SU-L4 |
| Email bombing | SU-M2, SU-L3 |

## Proposed threat-model rows (not applied; I did not edit THREAT_MODEL.md in this review)

| ID | Proposed status | What remains |
|---|---|---|
| T-04 | Verified in code for the signup | Key is server-only, closure-held, absent from `dist/client`; custom three-scope key, rotation and `0600` env file still to be done on the host (SU-L1, B-19) |
| T-05 | Verified in code for the signup | No PII in logs, bodies, `custom_source` or errors; Klaviyo bodies never read. Network inspection with a real account waits for CLR-004 |
| T-08 | Verified in code for the new action | Origin and Fetch Metadata refused in tests; behaviour behind nginx still P-L5 |
| T-10 | Partial, unchanged | Klaviyo is server-to-server; no script, no CSP host. Turnstile, if chosen, needs a CSP and owner decision |
| T-13 | Partial | Limiter verified in tests; SU-M2 (ceilings, no host zone), SU-L2, SU-L3, SU-L4 open; per-process counters until P6-14 |
| T-16 | Partial | Explicit unticked consent, versioned sentences, SMS off in production verified; SU-M1 (double opt-in evidence), SU-M3 (SMS ownership), counsel review of wording and SMS (Q-012, Q-015, Q-021) |

## Residual risks and what I could not verify

- Everything about real Klaviyo behaviour: acceptance of the body, 202 for known addresses, list membership, whether the suppression is cleared before confirmation, whether a pending profile is re-mailed, `custom_method_detail`, whether a restricted key with exactly the three scopes works, what an SMS subscribe sends, the `custom_source` length limit.
- The list's actual opt-in setting (none exists yet).
- Browser behaviour: hydration, focus, axe, the e2e spec (not run); the nginx behaviour (`nginx -t` never run; no `/signup` zone yet); the real address header on the host (Q-003); how discoverable the company id and list id are.
- The tests I ran are the author's own against a typed fake; they prove the handler, not Klaviyo.
- Risk acceptances needed from the owner (proposed, not recorded): the victim lock-out (SU-L2), per-process counters on the single VPS, the residual distributed confirmation-mail volume after the SU-M2 fixes.

## Escalations for the orchestrator

1. Gate item: SU-M1 evidence (double opt-in list setting and sandbox behaviour) before any real key; add to V-22 and BLOCKERS.
2. Devops: `mf_signup` zone in `deploy/nginx.conf.example`, `TRUSTED_CLIENT_IP_HEADER`, secret handling in the runbook.
3. Developer: lower the overall ceiling and add a daily cap (SU-M2), a per-phone counter before SMS can be switched on (SU-M3), the `shouldRevalidate` exception (SU-L4), a clean lockfile (SU-I6).
4. Owner/counsel: acceptances above; SMS number-verification decision; privacy policy naming Klaviyo.
