---
paths:
  - "storefront/**/*.{ts,tsx}"
  - "scripts/**/*.{ts,mjs}"
  - "shopify-app/**/*.{ts,tsx}"
---

# TypeScript rules

- `strict` stays on. No `any`: use `unknown` and narrow, or a typed schema parse at every trust boundary (Shopify responses are typed through generated types; Extend, webhook and form input are validated before use).
- No non-null assertions (`!`) or `as` casts to silence the compiler, except for a documented, tested narrowing helper. Fix the type instead.
- Model states as discriminated unions (for example `{ status: 'ok', data } | { status: 'error', reason }`), not booleans plus nullable fields. Integration calls return a typed result; they do not throw for expected failures.
- Pure logic (offers, scoring, eligibility, filters, linking, snapshot building) lives in `app/lib/**` as plain functions with no framework imports, so it is trivially unit-tested.
- Money is an integer in the minor unit or a Shopify `MoneyV2` object; never do arithmetic on formatted strings or floats. Format only at the edge with the shared helper (USD only, NFR-008).
- Exhaustive `switch` on unions with a `never` check. Prefer `const`, immutable data, small functions, named exports.
- Imports: no deep relative `../../../`; use the project alias. No circular imports. No default exports for non-route modules.
- Comments explain *why* (a Shopify or Extend constraint, a decision ID), not what. No commented-out code, no TODO without a backlog task ID.
- Do not upgrade TypeScript, React Router, Vite or Shopify packages outside the template's pins without a passing CI and a recorded note (ADR-0002).
