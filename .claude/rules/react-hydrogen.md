---
paths:
  - "storefront/app/**/*.{ts,tsx}"
---

# React and Hydrogen rules

- **Loaders and actions are the data boundary.** Fetch in route loaders on the server through the typed query modules in `app/lib/shopify/`; components receive plain props and never call Shopify directly. Mutations go through route actions.
- **Shopify is the source of truth.** Never compute or accept a price, discount or availability from the browser. Send variant IDs and quantities; read prices back from Shopify.
- **Cache deliberately.** Choose a Hydrogen cache strategy per query (see [ARCHITECTURE](../../docs/architecture/ARCHITECTURE.md#7-caching)). Never cache cart, customer, order or ZIP-dependent data, and never put personal data in a cache key.
- **Cart:** use Hydrogen's cart handler; optimistic updates must reconcile with the server result; handle `userErrors` and `warnings` from every cart mutation.
- **Checkout:** hand off to the cart's `checkoutUrl`. Never build or embed a replacement checkout (ADR-0003).
- **Streaming and errors:** defer non-critical data; every route has an error boundary with a recoverable state; third-party failures hide their UI and log, never block (NFR-013).
- **Environment:** read configuration only from the request context env, not from global `process.env` or runtime-specific globals; keep platform-specific code in `app/lib/platform.ts` (ADR-0004).
- **Client bundle:** keep it small. Lazy-load heavy, route-specific code (quiz, comparison, maps). Third-party scripts load after consent or interaction. Nothing server-only (private tokens, Admin API, Extend credentials) may be imported from a module that reaches the client.
- **Forms and URLs:** state that should be shareable (filters, sort, size, step) lives in the URL; validate every parameter against known values.
- **Hooks and components:** no data fetching in `useEffect` for first render; derive state instead of syncing it; stable keys; no `dangerouslySetInnerHTML` with unsanitised content.
- **Accessibility is part of done:** semantic elements first, labelled controls, focus management for dialogs and drawers, and a keyboard path for every interaction.
- Use Shopify's `Image`, `Money`, `Analytics` and SEO helpers where they exist instead of rebuilding them. Check current official docs before using an API from memory; Hydrogen changes quarterly.
