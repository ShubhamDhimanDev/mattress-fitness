# Security review: content pages, policies, blog and article pages (P6-09, REQ-CNT-001, REQ-CNT-002)

Date: 2026-10-25. Reviewer: security-engineer. Read-only review of code; no browser, no call to Shopify, no nginx. The only file written is this note (scratch probes live in the session scratchpad, nothing in the repository). Branch `feat/content-pages-and-signup`, range `3b215a1..HEAD` (HEAD `a576faf`): `4ed44e6`, `dbfffca`, `ae8e606`, `b20c2b0`, `a2e8b2a`, `a576faf` (55 files). The signup work in the working tree (`app/lib/signup/`, `storefront/package-lock.json`) was ignored. Threats: T-07, T-08, T-13, T-15 (also T-05 logging, T-12 dependencies, T-16 headers).

## Verdict

**PASS (no High), with two Medium findings to fix before this goes to a public URL.** The sanitiser, the anchor scheme, the JSON-LD and meta construction, the redirects, the handle and cursor validation and the canonical rule hold up under 300,000 fuzzed inputs and about 100 hand-written hostile ones. What does not hold up is cost, not safety:

- **C-M1 (Medium):** the heading scan is quadratic in the number of identically titled headings. A 24 KB page made of 2,000 `<h2>FAQ</h2>` blocks costs 1.7 s of CPU on every request of that page, 96 KB costs 22.7 s. Needs Shopify content-write access, no exploit of ours.
- **C-M2 (Medium):** cache-key flooding with valid but unknown handles (and the new article neighbours query) can evict the footer existence entry that every document request now waits for. The pattern already exists for products and collections; this range adds three routes to it and ties one evicted entry to every page.
- Five Low and four Info items below. No risk acceptance is needed for the verdict; C-M2 needs the owner to choose between fixing and accepting if the code fix is deferred.

No secret in the range. No new dependency (`package.json` and the lockfile are untouched by the six commits). `npm audit --omit=dev` on the working tree: 7 findings (1 low, 4 moderate, 2 high: esbuild, lodash, react-router), the set already tracked by ADR-0008 and R-23; unchanged.

## Method

Read: CLAUDE.md, `.claude/rules/security.md`, THREAT_MODEL (T-07, T-08, T-13, T-15 rows and the earlier verification notes), then every file named in the request: `app/lib/pages/content-pages*.ts`, `app/lib/shopify/content-pages-data.ts`, `app/lib/shopify/sanitize-html.ts`, `app/components/SafeHtml.tsx`, `app/components/pages/ContentArticle.tsx` and `ArticleList.tsx`, the routes `pages.$handle`, `policies.$handle`, `policies._index`, `blogs._index`, `blogs.$blogHandle._index`, `blogs.$blogHandle.$articleHandle`, `app/lib/seo/canonical.ts` and `robots.ts`, `app/lib/site-origin.ts`, `app/lib/shopify/jsonld.ts`, `app/lib/redirect.ts`, `app/lib/navigation.ts` (diff), `app/root.tsx`, `app/entry.server.tsx`, `app/lib/security-headers.ts` (CSP parts), `app/lib/logging/logger.ts`, `deploy/nginx.conf.example` (rate zones), `scripts/node-server/cache.mjs`, the installed `react-router@7.16.0` and `@shopify/hydrogen@2026.4.7` code where behaviour mattered.

Ran (real results, 2026-10-25, Windows, Node 22.23.3):

| Check | Result |
|---|---|
| `vitest run` on `content-pages-html`, `sanitize-html`, `content-pages-seo`, `content-pages`, `content-pages-routes` | 5 files, 211 tests, pass |
| Hand probe of `sanitizeHtml` with 100 hostile inputs (schemes with case, tab, newline, control characters, NBSP, zero-width, full-width, entity-encoded with and without semicolon, `&Tab;`, `&NewLine;`, `&colon;`, `&#0;`, out-of-range code points; backslash and `//` hosts; duplicate `href`; `<a/href=`; srcset, style, id, name, class, target; svg, math, foreignObject, iframe, object, embed, form, base, meta refresh, link, template, noscript, style, title, textarea, xmp, plaintext, noembed, noframes, listing, CDATA, comments, `--!>`, split tags such as `<scr<script>ipt>`) | no script-capable output in any case; every dangerous attribute or URL dropped; text re-escaped |
| Grammar fuzz: 300,000 random strings built from 80 hostile fragments, output checked against the allow-list (only allowed tags, only allowed attributes per tag, `href` only `http/https/mailto/tel` or a single-slash, `#` or `?` path, `src` only `https`, no stray `<` or `>`) | 0 violations |
| Timing of `sanitizeHtml` on 22 adversarial 300 KB inputs (unterminated quotes, `<a` runs, comment runs, 60,000 nested divs, `&` runs, long entities, long attributes) | worst 119 ms (30,000 headings), most under 65 ms; linear, no ReDoS in the tokenizer or the attribute regex |
| Timing of `scanHeadings` on identical headings | 1,000: 0.22 s; 2,000: 1.7 s; 4,000: 5.9 s; 8,000: 22.7 s; 30,000: did not finish in 15 s |
| Timing of `plainText` on raw (unsanitised) input | 64 KB of `<a` repeated: 1.8 s; 64 KB of `<!--`: 0.47 s, 300 KB: 12.2 s; 64 KB of `<script ` : 0.59 s; 300 KB of `<a`: did not finish in 15 s |
| `npm audit --omit=dev` | 7 vulnerabilities, unchanged, no package in the range |
| Reading `react-router@7.16.0` `chunk-QUQL4437.mjs:9933-9947` and `:8127-8137` | `script:ld+json` is `JSON.stringify`ed and then `<`, `>`, `&`, U+2028, U+2029 are escaped to `\uXXXX` before `dangerouslySetInnerHTML` |
| Reading Hydrogen `storefront.query` | `shouldCacheResponse: !body.errors`; cache key is URL + method + header hash + the whole body (query and variables) |

Not re-run by me: the e2e specs (`content-pages.spec.ts`, `shell.spec.ts`) and `progress/TEST_RESULTS.md` claims. They are agent-reported.

## Findings

### Medium

**C-M1. Quadratic heading scan and no caps on headings, contents entries or FAQ pairs (T-13, T-07 availability, T-15)**

- Evidence: `app/lib/pages/content-pages-html.ts:168-183`. For each heading the unique id is found by `for (let n = 2; used.has(id); n += 1)` (line 177), starting again at 2 for every heading, so k headings with the same slug cost O(k squared) string builds. Measured: 2,000 identical `<h2>FAQ</h2>` (24,000 bytes of sanitised HTML) 1.7 s; 4,000 5.9 s; 8,000 22.7 s. `buildContentDocument` runs on every request of the page (`content-pages-view.ts:92-94`; the document is `private, no-cache`, `root.tsx:106-108`, so no shared cache absorbs it) and the nginx general zone allows 20 requests a second per address with a burst of 60 (`deploy/nginx.conf.example:65`, `:245`). The same input also produces a table of contents of up to 30,000 links (`MIN_TOC_ENTRIES` is a floor, there is no ceiling, `:21`) and, on the FAQ page, up to roughly 15,000 JSON-LD questions at 4 to 5 times the source size (`extractFaqPairs` `:196-212`, no count cap; `buildFaqPageJsonLd` `content-pages-seo.ts:165-176`). The head data travels twice, in the document and in the loader data.
- Precondition: write access to a Shopify page, policy or article (a staff or app account, or a pasted document with thousands of repeated headings). No visitor can create it. T-15 still says Shopify content is untrusted data, and one 24 KB edit then takes a worker for seconds per request.
- Impact: event-loop stall on the own-server option (single thread), CPU-limit error on Workers; availability of every page behind the stalled worker.
- Fix (developer): keep a `Map<string, number>` of how many times each base id was used and start the suffix there (amortised O(1), still check `used` once so a heading "FAQ 2" cannot collide with the second "FAQ"). Cap anchored headings (for example 200; `SafeHtml` already tolerates a short `ids` list because `ids[position++] ?? ''` fails `SAFE_ANCHOR` and leaves the tag bare, `SafeHtml.tsx:30-33`), cap the contents list at the same number and the FAQ pairs at 50 to 100. Add a unit test with 5,000 identical headings that must finish in well under a second.

**C-M2. Cache flooding with valid unknown handles and cursors; the footer existence entry sits on every request's critical path (T-13)**

- Evidence: every route accepts any handle matching `^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$` (`collection-data.ts:21-26`) and queries Shopify with the long catalog strategy (1 hour fresh plus 23 hours stale, `cache.ts:22`; Hydrogen `CacheLong` = 3600 s + 82800 s). A page or article that does not exist returns `{page: null}` or `{blog: {articleByHandle: null, ...}}` with no GraphQL error, and Hydrogen caches any response without `errors`, keyed by the full variables. So `GET /pages/<random>` and `GET /blogs/journal/<random>` each add a cache entry that lives up to 24 hours; the article one carries the 100-handle neighbours list (`blogs.$blogHandle.$articleHandle.tsx:34`, `:214`, roughly 8 to 12 KB of JSON). Blog and blogs listings do the same with any cursor that matches `[A-Za-z0-9+/=_.~:-]{1,512}` (`filters.ts:197`, `content-pages-blog.ts:16-30`). On the Node host the stand-in cache holds at most 500 entries per named cache and evicts the oldest write first (`scripts/node-server/cache.mjs:112-115`, `:159`). About 500 junk URLs, 25 seconds at the nginx general rate from one address, push out the one entry that matters most: the aliased 15-page availability query (`content-pages-data.ts:30-54`, read at `:117`), which the root loader awaits on every document request (`root.tsx:136-143`).
- Cost of a miss: one Storefront request carrying up to 15 page bodies (their size limit in Shopify is unverified), a multi-MB JSON parse and, in the same request, sanitising each body (the memo `pageHasContent` `:105-113` is keyed by body text and cleared at 64 entries). There is no single-flight on a cold miss (Hydrogen deduplicates only the stale refresh), so concurrent requests each pay it. A hit is not free either: the whole 15-body blob is parsed from the cache on every request just to learn 15 booleans.
- Scope note: the junk-handle pattern is pre-existing for products and collections (T-13 "Partial", B-19, no host rate limit yet). New here: three more routes, a 10 KB payload per junk article URL, and a critical-path entry that makes eviction visible to every shopper.
- Impact: Shopify call amplification and slower pages for all shoppers while the flood lasts; no data exposure.
- Fix (developer): (1) hold the computed `ContentAvailability` in a module-level memo with a TTL (for example 5 minutes) and stale-on-error, so cache eviction and JSON parsing leave the request path; (2) for handles that are not in the registry or the known article window, query with `storefront.CacheShort()` (10 s) instead of the long strategy, or better, resolve unknown page handles against a cached handle index (`pages(first: 250) { nodes { handle } }`) and 404 without a per-handle read; (3) keep nginx limits for `/pages`, `/blogs` and `/policies` in the B-19 abuse test (T-13 row) and run it on a real host. If the owner wants to defer (2), propose accepting the pre-existing pattern in writing; (1) should not wait.

### Low

**C-L1. `plainText` is quadratic on raw input and is applied to raw Shopify strings (T-13)**

- Evidence: `content-pages-html.ts:69-74` (`/<(script|style)\b[\s\S]*?<\/\1\s*>/` and `/<\/?[a-zA-Z][^>]*>|<!--[\s\S]*?-->/`) rescan to the end of the string for each unterminated opener. `seoText` (`content-pages-seo.ts:33-35`) feeds it raw SEO titles and descriptions, tags, author names, image alt text, and the article excerpt, which the blog list runs for 12 articles per request (`blogs.$blogHandle._index.tsx:85`) and the article page once. Timings in the table above (64 KB: 0.5 to 1.8 s; 300 KB of `<!--`: 12 s). Calls on already sanitised HTML are safe because the sanitiser closes every tag and escapes every `<`.
- Impact: staff-controlled input only (the excerpt is HTML with no small limit; I could not verify Shopify's caps on SEO fields and summaries). Same class as C-M1.
- Fix: cut the input to a few thousand characters before the regex (`plainText(value.slice(0, max * 8))` in `seoText`), or sanitise first and then take the text.

**C-L2. Every page view sanitises its body at least twice on the server and once more in the browser, with no per-body memo (T-13)**

- Evidence: `buildContentDocument` (`content-pages-view.ts:92`), `SafeHtml` during server rendering (`SafeHtml.tsx:50-53`), and again on hydration; the articles route also sanitises twice (`content-pages-article.ts:102`, `SafeHtml`). The raw body travels in the loader data. Worst case measured about 115 ms per pass for 300 KB of dense markup. Legitimate pages (policies of 30 to 100 KB) cost 10 to 40 ms per pass.
- Impact: CPU per request, bounded by the 300,000-character cut (`sanitize-html.ts:10`). Not a safety issue; the double pass is also what keeps heading positions aligned.
- Fix: reuse the sanitised string (pass `clean` to `SafeHtml` and drop the second server pass), or put it in the same bounded memo as `pageHasContent`. Keep sanitising in the browser only if the bundle budget needs the raw body.

**C-L3. A valid but unknown cursor reaches Shopify uncached, or is cached per value (T-13)**

- Evidence: `blogPaginationVariables` validates shape and direction (good, `content-pages-blog.ts:16-30`; the value only ever travels as a GraphQL variable, never in the query text). It cannot validate that Shopify issued the cursor. With an error response nothing is cached and every request costs a Shopify call; without one, each value is a new cache entry (same mechanism as C-M2). What Shopify answers for a bogus cursor is unverified; if it answers with a GraphQL error, `storefront.query` returns it in `errors` and the route would show an empty or 404 state, not a stack trace (fixed message in production, `root.tsx:318-333`).
- Fix: lower `CURSOR_PATTERN` to the real cursor length range once seen on a store (Shopify cursors are about 50 to 200 characters), and treat as in C-M2 for the rate side.

**C-L4. `redirectIfHandleIsLocalized` redirects to an absolute URL built from `request.url` (T-08)**

- Evidence: `app/lib/redirect.ts:10-21`, called by the pages, blog and article routes. The path part is safe (the handle is validated by `isValidHandle`, the replacement is Shopify's own handle, no query value is used as a target), so there is no open redirect. The `Location` host is whatever Host header the server saw. The response is a 302 with no cache headers, so no shared cache keeps it by default.
- Impact: none by itself; matters only if a CDN ignores Host and caches 302s (Q-003, P-L5, the same note as P-L2 for canonicals).
- Fix: return a relative `Location` (`url.pathname + url.search`) or take the origin from `resolveSiteOrigin`.

**C-L5. Insecure `http:` links and any `https:` image host are allowed in content (T-07, T-16)**

- Evidence: `sanitize-html.ts:167` allows `http`, `https`, `mailto`, `tel` for `href`; `:171` allows any `https` host for `src`. This is the intended allow-list. The enforced CSP (Hydrogen's nonce policy with the Shopify CDN, `entry.server.tsx:42-76`) is what stops an off-site image from loading; I did not confirm in a browser which `img-src` Hydrogen's default sends, and the report-only policy lists `'self'`, `data:` and the Shopify CDN (`security-headers.ts:243`).
- Impact: if the enforced policy does allow arbitrary image hosts, an author could embed a tracking pixel; staff-only. If it blocks them, legitimate off-site images silently fail.
- Fix: decide the rule in the content guide (images from Shopify Files only) and add a one-line test that the enforced header's `img-src` does not contain `https:` or `*`.

### Info

- **C-I1. JSON-LD safety rests on React Router's `escapeHtml`.** The strings do contain `</script>` after entity decoding (`plainText` turns `&lt;/script&gt;` into text; probe output: `"text":"A two </script><script>alert(1)</script>"`), and `meta` hands the object to `script:ld+json`, which React Router 7.16.0 escapes (`chunk-QUQL4437.mjs:9935-9941`, `:8127-8137`). The pin is held (ADR-0008) and will move at the planned upgrade. No test renders `<Meta>` with a `</script>` payload (`u003c` appears only in `app/lib/stores/jsonld.ts`). Add one so an upgrade cannot silently lose it.
- **C-I2. Heading ids are safe from DOM clobbering.** Authors cannot set `id`, `name` or `class` (the sanitiser has no attribute for them; probe: `<h2 id="main" name=x>` becomes `<h2>`). Ids are generated in the loader as `section-<ascii slug>` (a-z, 0-9, hyphen, at most 60 characters plus a suffix), re-checked against `^[a-z0-9-]{1,80}$` in `SafeHtml.tsx:17`, `:24-34`, and contain a hyphen, so they are not reachable as `window.section-x` identifiers. `getElementById` is not used anywhere in `app/`; the only other `section-` id is `home-section-N`. Non-Latin headings give poor anchors (`Été 中文` becomes `section-t`; a pure CJK heading becomes `section-<position>`); a usability point, not security.
- **C-I3. Control characters survive inside an accepted URL.** `safeUrl` checks the compacted form but returns `decoded.trim()` (`sanitize-html.ts:140-151`), so `\u0001https://x.com/a.png` is emitted with the control character. Browsers strip it, the scheme check already ran on the stripped form, and the value is attribute-escaped, so no bypass was found; returning the compacted form would remove the oddity.
- **C-I4. Unclosed drop-tags swallow the rest of a page.** An unclosed `<head>`, `<title>`, `<select>`, `<template>`, `<math>` or `<svg>` removes everything after it (`sanitize-html.ts:15-30`, `:231-237`); safe, but an author pasting from Word can lose text with no warning. Input beyond 300,000 characters is silently cut (`:10`, `:213-214`).

## Checked and clean

| Question | Result and evidence |
|---|---|
| Sanitiser allow-list: tags | 40 allowed tags (`sanitize-html.ts:32-70`), none script-capable; `h1` renamed to `h2` for opening and closing tags (`:73`, `:240`); unknown tags lose the tag and keep escaped text; `script`, `style`, `iframe`, `object`, `embed`, `noscript`, `template`, `svg`, `math`, `textarea`, `select`, `title`, `head` lose their content (`:16-30`) |
| Attributes | `a`: `href`, `title`; `img`: `src`, `alt`, `width`, `height`; `th`/`td`: span attributes (`:75-80`). No `style`, `class`, `id`, `name`, `srcset`, `target`, `on*`. Duplicates keep the first accepted value; sizes must be 1 to 4 digits; every value is attribute-escaped with double quotes (`:123-129`, `:205`). `rel="noopener noreferrer"` on every link with an `href`; no `target`, so no tabnabbing (`:207`) |
| URL schemes | `javascript:`, `vbscript:`, `data:`, `blob:`, `file:`, `ftp:`, `sms:` dropped in every encoding probed: mixed case, tab, newline, leading control characters, NBSP, zero-width space, full-width letters, `&#9;`, `&Tab;`, `&NewLine;`, `&colon;`, `&#x6A;`, `&#106` without semicolon, double-encoded `&amp;#106;`, `&#0;`, out-of-range code points. Protocol-relative (`//host`), backslash forms (`/\host`, `https:\\host`, `/&#92;host`) and scheme-less relative paths are dropped. The check decodes entities and strips whitespace and controls first (`:136-162`) and the output re-escapes `&`, so the browser sees exactly what was checked |
| Entities, mutation XSS | Text re-escaped; `&lt;script&gt;` stays inert text. The output contains only allow-listed, well-formed tags and no foreign-content (svg, math), raw-text (style, textarea, title, xmp) or template elements, so the usual re-parsing differences cannot create a script. Nesting depth capped at 40. Fuzz run found no breakout |
| Size and time | 300,000-character cut before parsing; worst input 119 ms; output growth at most 5 times (`&` runs) |
| Unicode normalisation | None is applied, and none is needed: browsers do not normalise schemes, and full-width or NBSP-padded schemes fail the scheme test and fall through to deny |
| Heading id generation and TOC anchors | See C-I2; positions line up because the loader and `SafeHtml` both run the same sanitiser over the same raw body and the same `<h[23]>` pattern (`content-pages-html.ts:139`, `SafeHtml.tsx:16`) |
| JSON-LD from page text | Built from plain text of the sanitised page; answers capped at 5,000 characters, questions at 300 (`:187-188`); FAQPage only with 2 or more clear pairs and only on the registry's FAQ page; Article requires a valid date and headline; no rating, no publisher invented. Escaping per C-I1. Counts are the gap (C-M1) |
| OG and meta values | Every value passes `seoText` (tags stripped, control characters removed, whitespace collapsed, length capped: title 120, description 300, tags 40 each, at most 10 tags). Rendered through React attributes. Probe: description `x"><script>alert(1)</script>` becomes `x">` as a text value. `og:image` only when `https://` and only from Shopify's `image.url`; nothing is fetched by the server, so no SSRF |
| Canonical and origin | `canonicalUrl(origin, path)` with the origin from `PUBLIC_SITE_URL` only (`site-origin.ts:39-52`), https only except loopback, request origin only in development; the path for pages and policies comes from the validated handle or a closed list (`policies.$handle.tsx:16-21`, `:57`); article and blog paths are `encodeURIComponent`ed (`content-pages-blog.ts:73-79`). No query string reaches the canonical. Without an origin there is no canonical. The `Link` header is built the same way (`entry.server.tsx:91-103`, not in the range) |
| Redirects `/pages/privacy-policy`, `/pages/terms` | Target comes from the registry (`/policies/privacy-policy`, `/policies/terms-of-service`, `content-pages.ts:197-199`, `:253-260`), never from input; status 302 with `Cache-Control: no-store` (`pages.$handle.tsx:53-58`); only when no Shopify page with content has the handle. No open redirect |
| Handle validation | `isValidHandle` on the page, blog and article handles before any read (`pages.$handle.tsx:31`, `blogs.$blogHandle._index.tsx:39`, `blogs.$blogHandle.$articleHandle.tsx:38`); policy handle matched against a closed list by equality, not used as a key |
| Cursor and direction | Cursor must match `CURSOR_PATTERN` (no quote, brace, space or newline), direction `next`, `previous` or absent, anything else gives page one; the value is a GraphQL variable only. No injection path. Cost side: C-L3, C-M2 |
| Cache behaviour | Content documents inherit the root `private, no-cache` and `Vary: Cookie` (`root.tsx:106-108`; none of the content routes exports `headers`); the Shopify reads hold no price, availability or shopper data and use the catalog cache, which is correct for them. No personalised data in any cache key (keys are handle and cursor). No `action` on any of the routes, so no CSRF surface |
| noindex | Empty page gives `noindex,follow` (`content-pages-seo.ts:115-118`, `content-pages-view.ts:101`); missing page is a real 404; paginated blog pages canonicalise to the plain blog URL (DEC-044). `/policies` has only a title (no canonical, no robots tag): indexable, harmless |
| External link rel | All content links carry `noopener noreferrer`; internal navigation uses `Link`; no `target` |
| Error pages and logging | The 404/500 text is fixed in production, details only under `import.meta.env.DEV` (`root.tsx:313-333`); thrown `Response` bodies are literals. The new code logs one event, `content.pages_read_failed`, with the error class name only, once per run of failures (`content-pages-data.ts:105-129`); no request value, no page text. Existing `render.failed` logs the class name only |
| Secrets, third parties | No env access beyond `PUBLIC_SITE_URL`; no new script, host or provider; CSP code untouched in the range |

## Aliased 15-page query and the 100-article neighbours query

- 15-page query (`content-pages-data.ts:30-54`): one request, fixed text (the handles are literals, not input), cached 1 hour with 23 hours stale. It amplifies only on a miss and it is the entry C-M2 says can be evicted; every hit still parses up to 15 bodies. If exact "text or image" detection is not essential for the footer, the Storefront `Page.bodySummary` field (plain text, short) would shrink the payload to a few KB, at the price of treating an image-only page as empty. A cheaper route that keeps the rule: compute the booleans once and keep only those in a module memo (C-M2 fix 1).
- 100 newest articles (`blogs.$blogHandle.$articleHandle.tsx:214-219`): handle and title only, no HTML, fixed size cap of 100, and only the two neighbours leave the loader (`:81-95`). The cost is that a junk `articleHandle` for a real blog caches a 10 KB response per value (C-M2). Safe from a data point of view. If cache pressure matters, read the neighbours with a separate query keyed only by blog handle so there is one shared entry instead of one per article.

## Threat model rows (proposed text for the verification column; I did not edit THREAT_MODEL.md)

| ID | Proposed status | Result of this review |
|---|---|---|
| T-07 | Verified in code for the content pages, policies, blog and article pages | Sanitiser re-probed (100 hand cases, 300,000 fuzz cases, 0 bypasses), heading ids namespaced and generated server-side, JSON-LD and meta cleaned. Open: no test for the framework's JSON-LD escape (C-I1); CSP `img-src` in a browser (C-L5); sanitiser behaviour in a browser untested |
| T-08 | Verified in code | No actions on these routes; redirects go only to closed-list paths with 302 and `no-store`; localised-handle redirect is same-origin by path but absolute by host (C-L4). S-M1 on account login is outside this range and unchanged |
| T-13 | Partial (two new Mediums) | C-M1 quadratic heading scan and missing caps; C-M2 cache flooding and the critical-path footer entry; C-L1 `plainText` on raw input; C-L3 cursor cost. Needs the real-host abuse test (B-19) |
| T-15 | Partial | Shopify content is treated as data end to end here (no markup from Shopify reaches the DOM unsanitised, no text becomes a command, URL or id). The remaining exposure is CPU from hostile content (C-M1, C-L1) |
| T-05 | Verified in code for this range | One class-name-only log event; no page text or request value logged |
| T-12 | Unchanged | No dependency change in the range; audit set the same as ADR-0008 |

## Could not verify

- Anything in a browser: how the sanitised markup, the contents list and the anchors render, scroll behaviour, and whether the enforced CSP blocks an off-site `<img>` (C-L5). The sanitiser output was proven against a grammar, not against a browser parser.
- Real Shopify behaviour: the maximum size of a page body, an article summary and the SEO fields; whether `page(handle:)` matches case-insensitively; what the Storefront API answers for a bogus cursor (C-L3); whether policies and pages with the same handle behave as the footer rule assumes. No dev store content exists (B-02, Q-018).
- Oxygen's `caches` behaviour under flooding (the 500-entry limit is the Node stand-in's, `cache.mjs`); the Workers CPU limit that would turn C-M1 into an error instead of a stall.
- nginx: `nginx -t` has never run; the rate zones were read, not exercised (B-19).
- Headers behind a real proxy or CDN on the redirect and 404 paths (Q-003, P-L5).
- The e2e and QA results recorded in `progress/TEST_RESULTS.md` (V-E214 to V-E226); not re-run.
- No fix has been applied or re-reviewed; this note reviews the code as committed.

## Actions

| Owner | Action | Finding |
|---|---|---|
| shopify-hydrogen-developer | Counter-based unique ids, cap headings, contents and FAQ pairs, regression test with 5,000 identical headings | C-M1 |
| shopify-hydrogen-developer | Module memo with TTL for the availability result; short cache or handle index for unknown page, article and cursor values; optional separate neighbours query | C-M2, C-L3 |
| shopify-hydrogen-developer | Length cut before the tag regexes in `seoText`; reuse the sanitised string | C-L1, C-L2 |
| shopify-hydrogen-developer | Relative `Location` in `redirectIfHandleIsLocalized`; test that `<Meta>` escapes a `</script>` payload; test the enforced `img-src` | C-L4, C-I1, C-L5 |
| devops-engineer | Include `/pages/<random>`, `/blogs/<blog>/<random>` and `?cursor=<random>` in the B-19 abuse test | C-M2 |
| project owner | Choose: fix C-M2 now, or accept the pre-existing junk-handle pattern in writing until the host rate limit exists. I propose fixing the memo (1) now and accepting (2) for launch. Nothing is recorded as accepted | C-M2 |
