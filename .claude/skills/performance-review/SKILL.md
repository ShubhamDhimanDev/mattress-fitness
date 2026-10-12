---
name: performance-review
description: "Measures and improves storefront performance against the approved budgets (proposed Core Web Vitals good at p75 on mobile, Lighthouse thresholds on key templates): LCP, INP, CLS, JavaScript weight, image delivery, caching and third-party cost. Use for any template before its gate, at Phase 7, and when a change adds client JavaScript or a third-party script."
---

# Performance review

## When to use

Phase 7 (P7-06); a new template; a new dependency or third-party script; a regression report. Requirement: NFR-002 (targets pending approval, Q-012; proposal: LCP 2.5 s, INP 200 ms, CLS 0.1 at p75 on mobile; Lighthouse performance 85 or more on key templates).

## Steps

1. **Baseline.** Build for production and measure home, collection, product, cart and quiz with Lighthouse (mobile profile, throttled) on the same environment each time; record three runs and the median. Use real-user data later if available.
2. **LCP.** Identify the LCP element; ensure the hero or product image is server-rendered, correctly sized through Shopify's image CDN, prioritised (not lazy) and not blocked by fonts or scripts.
3. **CLS.** Reserve space (explicit width, height or aspect ratio) for images, banners, the promo bar, reviews and offers; avoid late-injected content above the fold.
4. **INP and JavaScript.** Inspect bundle size per route; lazy-load route-specific code (quiz, comparison, maps); avoid long tasks; keep interactive handlers light; remove unused dependencies.
5. **Third parties.** Load analytics, chat, reviews and Extend after consent or interaction; measure each one's cost; defer or drop the worst offender.
6. **Caching and network.** Check cache strategies per `ARCHITECTURE.md` section 7, avoid waterfall requests in loaders (parallelise), stream non-critical data, confirm compression and long-lived static asset caching on the host.
7. **Fix the largest cost first**, re-measure, and keep a short before and after table. Add budgets to Lighthouse CI where practical so regressions fail the build.

## Outputs

`docs/testing/PERFORMANCE.md` with method, environment, baseline, changes and results; budget configuration; tasks for anything not fixed.

## Validation

Budgets are met on staging for each key template or the shortfall is documented with a plan and approved by the owner; measurements are reproducible (same profile and environment stated); no accessibility regression was introduced by a performance fix.
