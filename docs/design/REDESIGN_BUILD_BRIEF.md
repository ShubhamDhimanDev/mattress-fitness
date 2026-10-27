# Redesign build brief (CR-31): rules for every developer

Read this together with [REDESIGN_PLAN](REDESIGN_PLAN.md) and [REDESIGN_PRIMITIVES](REDESIGN_PRIMITIVES.md) (written by the foundation step, R1 and R2; it lists the tokens, utilities and primitives you build with). The mock-ups in [redesign-preview/](redesign-preview/) are the visual spec: copy the **look and layout**, never the hex values or class names.

## Goal

The owner approved a visual redesign (DEC-134). **Functionality does not change**: every behaviour, requirement ID, server rule, loader, action and query stays. You restyle and re-lay-out components, and the home page gets new content blocks. Existing tests are updated for new markup and class names, never loosened for behaviour, accessibility or security.

## Ownership (parallel work: stay inside your list)

Five developers work at the same time in the same working tree, each on files nobody else touches. If you need a change in a file that is not yours, **do not make it**: describe it in your report ("needs X in file Y") and work around it or leave a clearly marked gap. If a `ui/` primitive lacks something, do not edit it either: compose around it and report the gap.

| Area | Files |
| --- | --- |
| **Shell** | `app/components/layout/**`, `app/components/Aside.tsx`, `app/components/SearchFormPredictive.tsx`; tests `tests/e2e/shell.spec.ts`, `nav-menu.spec.ts`, `lazy-panels*.spec.ts`, `consent*.spec.ts` (markup only), `tests/unit/pages/shell-content.test.ts`, `tests/unit/lib/nav-menu.test.ts`, `menu-data.test.ts` |
| **Cart** | `app/components/CartMain.tsx`, `CartLineItem.tsx`, `CartSummary.tsx`, `app/components/cart/**`, `app/components/delivery/**`, `app/components/extend/**`, `app/routes/cart.tsx` (page markup only, never the action or loader logic), `app/routes/delivery.tsx` (markup only); tests `tests/e2e/cart.spec.ts`, `delivery*.spec.ts`, `protection.spec.ts`, `tests/unit/routes/cart-routes.test.ts` only if markup assertions exist |
| **Home and brands** | `app/components/home/**`, `app/components/brand/**`, `app/components/signup/**`, `app/routes/_index.tsx`, `app/routes/brands.$handle.tsx`, `app/routes/brands._index.tsx`, `app/lib/shopify/home-*.ts` and its queries, `scripts/shopify/definitions.json` (+ its tests), `scripts/setup/seed-entries.mjs`; tests `tests/unit/catalog/home-sections.test.ts`, `tests/e2e/home.spec.ts`, `brands.spec.ts`, `signup.spec.ts` |
| **Catalog** | `app/components/pages/ProductTile.tsx`, `app/components/collection/**`, `app/components/product/**`, `app/components/compare/**`, `app/components/reviews/**`, `app/components/ProductItem.tsx`, `app/components/PaginatedResourceSection.tsx`; routes `collections.*`, `products.$handle.tsx`, `search.tsx`, `compare.tsx`; tests `catalog.spec.ts`, `compare.spec.ts`, `product-addons.spec.ts`, `pickers.spec.ts`, `search.spec.ts`, `tests/unit/pages/compare-view.test.ts`, `search-results.test.tsx`, `tests/unit/routes/product-loader.test.ts` (markup only) |
| **Rest** | `app/components/quiz/**`, `app/components/stores/**`, `app/components/account/**`, `app/components/orders/**`, `app/components/chat/**` (look only), `app/components/consent/**` (look only), `app/components/pages/` (except `ProductTile.tsx`), `app/components/SafeHtml.tsx` (never weaken sanitising), routes `quiz.*`, `stores.*`, `account*`, `track-order.tsx`, `pages.$handle.tsx`, `policies.*`, `blogs.*`, `$.tsx` (404), `signup.tsx` (markup only); tests `quiz.spec.ts`, `stores.spec.ts`, `track-order.spec.ts`, `content-*.spec.ts`, `chat.spec.ts`, `consent*.spec.ts`, and the matching unit tests |

Nobody edits: `app/styles/**`, `app/components/ui/**`, `app/root.tsx`, `app/routes/_dev.components.tsx` (foundation, already finished), anything under `app/lib/` outside your list (server logic, offers, cart gate, delivery, Extend, analytics), `docs/**` (the orchestrator updates docs; you may add a short note to your report instead), `plans/**`, `progress/**`.

## Rules that do not bend

- **Tokens and primitives only.** No hex values, no one-off pixel sizes, no off-scale font sizes in components (`.claude/rules/ui-implementation.md`). Reuse the primitives in `app/components/ui/`.
- **Accessibility is part of done:** real `button`/`a`/`nav`/`ul`, labelled controls, visible focus (blue ring; yellow `.on-dark` ring on red and black bands), 44 px touch targets, headings in order, `aria-live` kept where it exists, no focus traps, `motion-safe:` on all motion, text contrast 4.5 : 1 (red text on the warm paper is 4.63, so 16 px and up or `primary-700`).
- **Mobile first** at 360 px, no horizontal scroll at any width; check 360, 768, 1280 and 1536 px.
- **No behaviour change:** prices come from Shopify, no price arithmetic in the browser beyond what exists, no new data fetching on first render, cart mutations only through the cart route, third-party failures hide their UI (NFR-013). Content from Shopify is rendered through the existing sanitising renderer only.
- **No invented facts.** Placeholder wording in the mock-ups (guarantees, delivery promises, plan terms, phone numbers, "ends [date]") must not ship as real copy: use the existing admin-driven content and the existing "only show when the content exists" rules (B-15). Brand names are text; no logos.
- **No new dependencies**, no framework or config changes, no `any`, no non-null assertions, no `.env` files, no committing or pushing.
- Images: use the Shopify image components already in use; new decorative images come from Shopify admin content, never hard-coded files. Where the design shows a photo with no admin source yet, render nothing or a neutral block, and say so in your report.

## How to run things

Bash tool (Git Bash, Node 22 through fnm; a harmless "fnm env" error may print on `cd`). `cd /c/zzz-shubham/MattressFitness/storefront`.

- Work in small steps. After each step run the **targeted** tests for your area, e.g. `npx vitest run tests/unit/catalog` or a single file, plus `npm run lint` and `npm run typecheck`.
- Others are editing at the same time, so lint or type errors in files you do not own are not yours: do not fix them, list them in your report, and re-run later. If your own files are clean, you are fine.
- Do not run the whole e2e suite. You may run the specs of your area with `E2E_ENV_FILE=.env.bedding npx playwright test <spec> --project=<chromium project from playwright.config>` if the server starts (see `docs/deployment/LOCAL_DEV_WALKTHROUGH.md` section 7h); if it does not, say so rather than fighting it. A spec that fails only because markup, text or class names changed is yours to update; one that fails on behaviour is a real defect: report it.
- At the end run `npm run lint`, `npm run typecheck` and `npm test` (all unit tests) once and report the real numbers.

## Definition of done for your area

Every page and state in your area matches the mock-ups and the plan on phone and desktop; loading, empty and error states exist and are styled; existing unit tests pass (updated only for markup); your e2e specs are updated; nothing outside your files changed; your report lists decisions, gaps, and anything you could not verify.

## Report format

Short and factual: files changed; what now matches the mock-up and what deliberately differs (and why); test, lint and typecheck results with real numbers; what you could not run or verify (do not claim browser checks you did not do); needs from files you do not own; follow-ups.
