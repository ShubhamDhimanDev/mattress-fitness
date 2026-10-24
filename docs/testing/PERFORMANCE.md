# Performance: budgets, how to measure, and the baseline

Requirement NFR-002 (status `Pending approval`, Q-012); task P7-06. Skill: `.claude/skills/performance-review`. Architecture: [ARCHITECTURE](../architecture/ARCHITECTURE.md) section 8. State at 2026-10-15: **budgets are PROPOSED, nothing here is approved by the client, and nothing has been measured on a development or staging store** (none exists yet, B-02/B-13). The numbers below are a local baseline against a mock store; they show the shape of the problem and prove the tooling works, they do not prove NFR-002.

## Proposed budgets (pending client approval)

| Measure                                                                            | Proposal                                                                                                                                  | Where it is enforced                                                                                                        |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Core Web Vitals "good" at the 75th percentile on mobile                            | LCP 2.5 s or less, INP 200 ms or less, CLS 0.1 or less                                                                                    | Field data after launch (Search Console, RUM, if the client enables it). Before launch only the lab proxies below exist     |
| Lighthouse performance score (mobile profile, simulated 4G, median of 3 runs)      | 85 or more on home, collection, product and cart; quiz, search and compare use the same bar                                               | `storefront/lighthouserc.json` (error)                                                                                      |
| Lab LCP / CLS on those templates                                                   | 2500 ms / 0.1 (median run)                                                                                                                | `lighthouserc.json`: LCP is a warning until Q-012 approves the number (the mock-store baseline exceeds it), CLS is an error |
| Lab Total Blocking Time (the lab proxy for INP; INP itself needs real interaction) | 200 ms or less                                                                                                                            | `lighthouserc.json` (warn)                                                                                                  |
| JavaScript transferred per page (all scripts, third parties included)              | 200 kB or less today; target 170 kB after the P7-06 fixes                                                                                 | `lighthouserc.json` `resource-summary:script:size` (warn)                                                                   |
| Initial client JavaScript per route (gzip, entry + root + route chunks)            | See the table below; measured size plus about 1.5 kB (re-baselined 2026-10-24), as a regression guard. Target after fixes: 170 kB or less | `npm run perf:bundle` (exit 1 when over, WARNING under 1 kB headroom)                                                       |

Per route group (gzip kB of JavaScript needed to start the route on a cold load, `scripts/perf/bundle-budgets.json`), re-baselined 2026-10-24 to the measured size plus about 1.5 kB (the earlier numbers were about 5 percent above the build and the analytics consent chunk, P7-01, used most of that margin): home 130.5, collection 139.5, product 141.5, cart and checkout-steps 137, search 137.5, quiz 133, compare 130, brand 138.5, stores 125.5, account 125.5, content pages and policies 123.5. A group's number applies to every route in it, so the largest route has about 1.6 to 2.7 kB of headroom and the smaller routes more. No budget was reduced (quiz and cart keep their earlier numbers).

**Rule for growth.** A feature that needs more than the headroom must first split code (lazy `import()` for anything not needed to start the route) or justify the extra weight and re-baseline the budget with a recorded decision (a line in `progress/DECISIONS.md`, with the measured before and after). Raising a number without that is not accepted. `npm run perf:bundle` prints the headroom of each route in bytes and a WARNING (exit code still 0) when a route has under 1 kB left; it fails only when a route is over. Treat the warning as the cue to split or re-baseline in the same change, not as noise: gzip of the content-hashed files moves by tens of bytes on any edit, so a margin of a few hundred bytes cannot be relied on.

Why a regression guard rather than a target: the shell alone is about 129 kB gzip on every route (see the baseline), so a 170 kB "industry" ceiling would let 30 kB of growth through unnoticed. The groups' numbers are tightened when the shell is reduced; changing them is a one-line edit reviewed like code. The client approves the Core Web Vitals and Lighthouse targets; the per-route JavaScript numbers are an engineering guard derived from them and are not a client commitment.

### Image rules (proposed, enforced by review and the LCP check)

- Product, collection and hero images come from Shopify's CDN with a width chosen for the slot (`sizes` and `srcset`), never the original upload. The CDN serves WebP or AVIF where the browser accepts it.
- Every image has explicit `width` and `height` (or an aspect ratio on its box) so it cannot shift the layout (CLS).
- The LCP image on a template (home hero, first product image, first collection row) is eagerly loaded with `fetchpriority="high"`; all other images below the fold use `loading="lazy"` and `decoding="async"`. Never lazy-load the LCP image.
- No image above 200 kB transferred in the first viewport on mobile; the whole first screen is 1 to 2 images.
- Fonts: system stack or at most one preloaded, `font-display: swap` family; no render-blocking font CSS from a third-party origin.
- Third-party scripts (analytics, consent, Extend, chat, reviews) load after consent or interaction, each measured before it is accepted (T-10).

## How to run

All commands run from `storefront/` in Git Bash with Node 22 (`.nvmrc`). None of them needs a new dependency.

**1. Bundle size per route (seconds, no browser).**

```
npm run build
npm run perf:bundle                  # table; exit 1 when a route is over its budget
npm run perf:bundle -- --json        # machine-readable
node ../scripts/perf/bundle-budget.mjs --dist dist/client --budgets ../scripts/perf/bundle-budgets.json
```

It reads React Router's build manifest (`dist/client/assets/manifest-*.js`), adds the entry, the root route, every parent layout and the route's own chunks (static imports only), gzips each file and compares. It follows the manifest, not the directory, because `dist/client/assets` keeps files from older builds. Lazy `import()` chunks are not counted (that is the point of lazy loading them). Unit tests: `node --test "scripts/**/*.test.mjs"` (`scripts/perf/bundle-budget.test.mjs`).

**2. Lighthouse CI (minutes, needs Chrome).** `@lhci/cli` is **not** a dependency of the project. Adding it needs an ADR (`.claude/rules/git-practices.md`: dependency changes need a reason, a compatibility check and a recorded decision), so run it through a pinned `npx`, which installs into npm's cache and leaves `package.json` and the lockfile untouched. About 300 transitive packages resolve to their newest in-range versions at run time (no lockfile) and their install scripts run on your machine (S-L5, T-12), so run it from a scratch directory that holds a copy of `lighthouserc.json`, not from the project, until an ADR adopts it as a devDependency; `npm run perf:lighthouse` prints that note above the command, and the command no longer carries `-y`, so npx asks before it installs:

```
npm run build
npx shopify hydrogen preview --port 4900 --env-file .env.prodpreview      # separate terminal; see PLAYWRIGHT_WORKFLOW.md, "Production preview"
export CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"   # if Chrome is not found
npx @lhci/cli@0.15.1 autorun --config=lighthouserc.json \
  --collect.url=http://localhost:4900/ \
  --collect.url=http://localhost:4900/collections/<a-collection-handle> \
  --collect.url=http://localhost:4900/products/<a-product-handle> \
  --collect.url=http://localhost:4900/cart
```

Reports go to `storefront/test-results/lighthouse` (git-ignored). `autorun` also creates a scratch `storefront/.lighthouseci/` that is not git-ignored: delete it after a run (or add it to `.gitignore`, a one-line change owned by the repository maintainer). `npm run perf:lighthouse -- --product <handle> [--collection <handle>] [--port 4900]` prints this exact command (it runs nothing); `lighthouserc.json` holds one set of thresholds for every URL, and the URLs are flags because two of them need a handle from the store being measured. Use a **production build** (never `npm run dev`: development mode ships unminified code and StrictMode doubles effects). 0.15.1 bundles Lighthouse 12.6.1. Pin the version and record it with every result; a new Lighthouse version changes scores.

Decision needed from the orchestrator: adopt `@lhci/cli` as a devDependency (reproducible CI, about 300 transitive packages, several deprecated ones as of 0.15.1) or keep the pinned `npx` command. Until an ADR exists the CI workflow does not run it.

**3. Field data (after launch only).** Core Web Vitals at p75 need real traffic: Search Console's Core Web Vitals report or the `web-vitals` library sent to an endpoint the client approves. Not built; INP cannot be measured in the lab.

## What can be measured where

| Measure                                                                       | mock store (`bedding.mock.shop`)                                                                                                                                             | Needs the development or staging store                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial JavaScript per route (`perf:bundle`)                                  | Yes, identical: it depends on the build, not the data                                                                                                                        | Same                                                                                                                                                                                                                   |
| Lighthouse score, LCP, CLS, TBT on the shell, home, collection, product, cart | Indicative only. The mock catalog has small apparel-style images and no mattress content, no metafield sections, no Extend panel, no offers, no consent or analytics scripts | Yes: real catalog images, metafield-driven sections, reviews, Extend, consent/analytics and the CDN in front of the host. Staging must be on the real host (Q-003), because caching and compression are host behaviour |
| Cache strategy effect (TTFB with warm cache)                                  | No (local preview, no CDN)                                                                                                                                                   | Yes, on staging                                                                                                                                                                                                        |
| Image delivery (formats, sizes, CDN transforms)                               | Partly (mock images go through Shopify's CDN)                                                                                                                                | Yes, with the client's images                                                                                                                                                                                          |
| INP, long tasks on filters, compare, quiz                                     | Only by hand in DevTools                                                                                                                                                     | Yes, with a full catalog (400 products)                                                                                                                                                                                |
| Third-party cost (consent layer, analytics, Extend)                           | No (not built or not connected)                                                                                                                                              | Yes, once P7-01 and the Extend sandbox are connected                                                                                                                                                                   |
| Field Core Web Vitals                                                         | No                                                                                                                                                                           | After launch only                                                                                                                                                                                                      |

## Baseline 2026-10-15

Build: `npm run build` of the working tree (branch `feat/p6-account-p7-seo-perf`, including uncommitted account-route work by another agent), Node 22, Windows. Measured by `npm run perf:bundle`.

### Initial JavaScript per route, local production build (not Lighthouse)

| Route                       | Files | Raw kB | Gzip kB | Budget kB |
| --------------------------- | ----- | ------ | ------- | --------- |
| `_index` (home)             | 38    | 396.0  | 135.2   | 150       |
| `collections.$handle`       | 43    | 407.2  | 140.7   | 155       |
| `collections.all`           | 42    | 405.9  | 140.1   | 155       |
| `products.$handle`          | 39    | 403.5  | 138.3   | 155       |
| `cart`                      | 32    | 382.6  | 129.7   | 145       |
| `checkout-steps`            | 32    | 391.8  | 131.7   | 145       |
| `search`                    | 41    | 407.3  | 140.5   | 155       |
| `quiz._index`               | 38    | 408.3  | 139.5   | 155       |
| `compare`                   | 39    | 396.4  | 135.8   | 150       |
| `brands.$handle`            | 45    | 408.6  | 141.4   | 155       |
| `brands._index`             | 35    | 385.0  | 131.1   | 155       |
| `stores._index`             | 37    | 388.7  | 132.5   | 150       |
| `stores.$state.$city.$slug` | 38    | 391.8  | 133.7   | 150       |
| `account`                   | 32    | 384.9  | 130.5   | 145       |
| `account.orders._index`     | 35    | 392.3  | 133.6   | 145       |
| `pages.$handle`             | 33    | 386.3  | 131.6   | 145       |
| `policies.$handle`          | 33    | 386.5  | 131.7   | 145       |

The stylesheet (one Tailwind file for all routes) is 42.3 kB raw, 9.0 kB gzip. Reading the table:

- **The shell is the cost.** The entry (React, React DOM, React Router, Hydrogen runtime) is about 98 kB gzip and the root route adds about 31 kB, so every route starts at about 129 kB; a page's own code adds 0 to 12 kB. A budget fight is won in the root, not in the templates.
- The root route's static imports include the cart drawer and cart contents (`CartMain`, `CartActionForm`), the delivery ZIP check (`DeliveryCheck`, `zip`), the accordion and the offer plan parts (`PlanParts`). They are needed only after the shopper opens the cart or the ZIP dialog, so they are the first candidates to lazy-load (P7-06 fix list, not done here: the root and header belong to other owners).
- The quiz, compare and store pages are only 4 to 10 kB above the shell, so the "keep the quiz, comparison and maps in route-level chunks" rule holds.

### Update 2026-10-16: shell panels lazy-loaded (P7-06), local build, not Lighthouse

Measured by `npm run build` then `npm run perf:bundle` on branch `feat/p7-shell-weight-phase2-a11y`, Node 22, Windows; **local baseline, mock store, nothing approved (Q-012)**. The cart drawer contents (`CartMain` and the offers, line, quantity and delivery-check parts it pulls in), the mobile menu (`MobileNav`, accordion), the ZIP dialog form (`ZipForm`, input, ZIP parser) and the search suggestion list (`SuggestionGroups`: option markup, Hydrogen `Image`, `Price`) now load as their own chunks (`app/components/layout/LazyPanel.tsx`, `lazyPanels.ts`). Each starts downloading when the shopper points at, focuses or presses its control (the cart also when the cart already has items, in idle time), and the add-to-cart buttons trigger it through the aside provider. None of the four is rendered on the server (the overlays mount their content on the client), so first paint, SEO and the no-JavaScript `/cart` link are unchanged. The "before" column is the same tree measured at the start of this task; the working tree also held other agents' uncommitted design-system edits (the stylesheet grew from 42.3 to 44.5 kB raw, 9.0 to 9.2 kB gzip), so a few hundred bytes of the difference are theirs. The `/cart` route still contains the cart UI because the page itself renders it.

| Route                       | Gzip kB before | Gzip kB after | Change | Budget kB (old, new) |
| --------------------------- | -------------- | ------------- | ------ | -------------------- |
| `_index` (home)             | 135.3          | 122.2         | -13.1  | 150, 129             |
| `collections.$handle`       | 140.8          | 130.7         | -10.1  | 155, 138             |
| `collections.all`           | 140.2          | 129.1         | -11.1  | 155, 138             |
| `products.$handle`          | 138.5          | 132.9         | -5.6   | 155, 140             |
| `cart`                      | 129.9          | 130.4         | +0.5   | 145, 137             |
| `checkout-steps`            | 131.8          | 119.7         | -12.1  | 145, 137             |
| `search`                    | 140.6          | 129.5         | -11.1  | 155, 136             |
| `quiz._index`               | 139.6          | 125.9         | -13.7  | 155, 133             |
| `compare`                   | 135.9          | 122.8         | -13.1  | 150, 129             |
| `brands.$handle`            | 141.5          | 130.4         | -11.1  | 155, 137             |
| `brands._index`             | 131.2          | 116.6         | -14.6  | 155, 137             |
| `stores._index`             | 132.7          | 116.5         | -16.2  | 150, 124             |
| `stores.$state.$city.$slug` | 133.8          | 117.6         | -16.2  | 150, 124             |
| `account`                   | 130.8          | 114.6         | -16.2  | 145, 124             |
| `account.orders._index`     | 133.9          | 117.7         | -16.2  | 145, 124             |
| `pages.$handle`             | 131.7          | 115.6         | -16.1  | 145, 122             |
| `policies.$handle`          | 131.8          | 115.7         | -16.1  | 145, 122             |

What is left: React DOM (42 kB gzip), React Router (43 kB) and the Hydrogen runtime (11 kB) are about 96 kB of every route and cannot be split; the root route adds about 7 kB, the header's shared parts (icons, store selector, navigation data, drawer frame) about 10 kB. The `product` and `collection` routes carry the cart-adjacent code they use themselves (add to cart, delivery check, prices, images). `bundle-budgets.json` now sits about 5 percent above these numbers (new group values are in the table; the file is the authority); it stays PROPOSED. The "Per route group" sentence under "Proposed budgets" and next step 3 below still describe the 2026-10-15 numbers and are not rewritten here. Not re-measured: Lighthouse (LCP, TBT, transferred script size); the expectation is a smaller first-load script transfer by roughly the same 10 to 16 kB, to be confirmed with the pinned `@lhci/cli` run.

### Lighthouse 12.6.1 through `@lhci/cli` 0.15.1, production preview, mock store: BEFORE the lazy shell panels (2026-10-15)

Mobile profile (Lighthouse defaults: Moto G Power emulation, simulated slow 4G, 4x CPU slowdown), 3 runs per URL, median. Store: `bedding.mock.shop` (CloudHaven Linens; no mattress content). Host: `shopify hydrogen preview` on the developer machine, no CDN, no compression guarantee, Windows laptop; the network to mock.shop and the CDN varies between runs.

| Template                      | Performance (runs) | Median LCP ms | CLS | Median TBT ms | Median script transfer | Image transfer | Verdict against the proposal                         |
| ----------------------------- | ------------------ | ------------- | --- | ------------- | ---------------------- | -------------- | ---------------------------------------------------- |
| Home `/`                      | 92, 88, 92         | 2677          | 0   | 10            | 181 kB                 | 212 kB         | score met; LCP 2.68 s over 2.5 s                     |
| Collection `/collections/all` | 89, 53, 72         | 4270          | 0   | 253           | 185 kB                 | 205 kB         | score and LCP not met; very noisy (LCP 2.4 to 4.9 s) |
| Product                       | 92, 90, 91         | 2523          | 0   | 15            | 184 kB                 | 42 kB          | score met; LCP 2.52 s, 20 ms over                    |
| Cart `/cart`                  | 90, 92, 91         | 2386          | 0   | 102           | 174 kB                 | 0              | met                                                  |

Exact script transfer sizes (median): 185,346 / 189,790 / 188,821 / 178,268 bytes. `assert` result with the committed config: LCP **warns** (the assertion is a warning until Q-012; it would fail as an error) on home, collection and product; script size warns on all four against the first guess of 160 to 165 kB, which is why the committed warning threshold is 200 kB. CLS is 0 everywhere. Do not read the LCP failures as a verdict: the mock store, the missing CDN and the developer machine all move them by seconds. What the run does show is that **the tooling works end to end**, that the first-screen LCP is dominated by the hero or first product image plus about 130 kB of shell JavaScript, and that the collection page is the likeliest template to miss the target (a grid of images and a hydration cost of 250 ms of blocking time in the worst run).

### Lighthouse 12.6.1 through `@lhci/cli` 0.15.1, production preview, mock store: AFTER the lazy shell panels (2026-10-16)

Build: commit `12034ce` (branch `feat/p7-motion-lighthouse-lazy-preview`, clean checkout exported with `git archive` to a scratch folder so other agents' edits and rebuilds of `dist/` could not change what was served), `npm run build`, served by `shopify hydrogen preview` with a synthetic env file (mock store `bedding.mock.shop`). Same profile as the table above: Lighthouse defaults for mobile, simulated slow 4G, 4x CPU slowdown; 3 runs per URL, medians; run from a scratch directory outside the repo with `npx --yes @lhci/cli@0.15.1 autorun` and a copy of `lighthouserc.json` (S-L5; nothing was installed into the repository). Same machine, a Windows laptop shared with other agents' builds and test runs, so noise is large. URLs: `/`, `/collections/all`, `/products/belgian-linen-duvet-cover` (the earlier run does not say which product it used, so the product row compares different pages), `/cart`.

| Template                      | Performance before (runs) | Performance after (runs) | Median LCP before to after (ms)                 | CLS | Median TBT after (ms) | Script transfer before to after (bytes, median) |
| ----------------------------- | ------------------------- | ------------------------ | ----------------------------------------------- | --- | --------------------- | ----------------------------------------------- |
| Home `/`                      | 92, 88, 92                | 93, 92, 92               | 2677 to 2757 (+80)                              | 0   | 0                     | 185,346 to 168,697 (-16,649; 30 files)          |
| Collection `/collections/all` | 89, 53, 72                | 88, 89, 89               | 4270 to 3028 (-1242; before run was an outlier) | 0   | 3                     | 189,790 to 177,329 (-12,461; 37 files)          |
| Product                       | 92, 90, 91                | 92, 92, 93               | 2523 to 2397 (-126)                             | 0   | 0                     | 188,821 to 182,045 (-6,776; 41 files)           |
| Cart `/cart`                  | 90, 92, 91                | 94, 93, 93               | 2386 to 2358 (-28)                              | 0   | 2                     | 178,268 to 179,958 (+1,690; 37 files)           |

Reading it honestly: the first-load script transfer fell by 6.8 to 16.6 kB on home, collection and product (the cart page renders the cart itself, so it carries that code and did not shrink), which matches the 5 to 16 kB the bundle table predicted. Scores are the same or a little higher; LCP moved by less than the run-to-run spread (home got 80 ms slower, collection 1.2 s faster, both inside the noise of this setup; the before collection row had a 53-point outlier). **Do not claim an LCP improvement from this**: LCP here is set by the hero or first product image and the 130 kB shell, not by the four panels. `assert` with the committed config: LCP warns on home (2763 ms) and collection (3028 ms), nothing else fails; script size is under the 200 kB warning line on all four; CLS 0 everywhere. Still a mock-store, local-machine result: nothing here proves NFR-002 (Q-012).

### Server-side change made with this groundwork (product page waterfall, review m7)

The product loader used to read the product, then the Extend category (needs the product id), then the offer-only handles. It now starts all four Storefront reads (product, availability, Extend category by handle, offer-only handles) together, because none of them needs the product id: the category is read with `product(handle:)` (`app/lib/shopify/protection-load.ts`), validated by the same parser as the offers route. On a cache miss that removes one sequential round trip (one Storefront query, typically 100 to 300 ms from Oxygen or an own server, to be measured on staging) from time to first byte. Behaviour is unchanged (same modes, same fallbacks); a unit test (`tests/unit/routes/product-loader.test.ts`) proves the reads start before any has answered. Cost: a request for a handle that does not exist now also issues the category and offer-only reads (both cached; an invalid handle makes no category read).

## Next steps (P7-06, in order)

1. Decide the `@lhci/cli` dependency (ADR) or keep the pinned `npx`; wire either into CI only after staging exists.
2. Get Q-012 approved by the client; then budgets stop being PROPOSED.
3. Reduce the shell: lazy-load the cart drawer contents and the delivery ZIP dialog from the root (owner of the root and header), re-run `perf:bundle`, then tighten `bundle-budgets.json`.
4. On the development store: three Lighthouse runs per key template with real content, record the median, fix the largest cost first (probably the LCP image), keep a before and after table here.
5. Add `web-vitals` field reporting only if the client wants real-user data (privacy and consent apply).
