# Storefront (Hydrogen app)

The Shopify Hydrogen storefront for the mattress and bedding retailer: React, React Router 7, TypeScript, Tailwind CSS. Project overview, status and the full documentation index are in the repository [README](../README.md). This folder began as Shopify's Skeleton template and is now project code.

## Requirements

Node.js 22 (`^22 || ^24` in `package.json`; `.nvmrc` at the repository root pins 22). Use Git Bash on Windows so fnm selects it.

## Setup

```bash
npm ci
```

Create `storefront/.env` (git-ignored). A fresh checkout has none and the app refuses to serve without `SESSION_SECRET`. The values for a public demo store are in [DEV_DATA.md](DEV_DATA.md); the complete variable list, with what fails without each one, is in [DEPLOYMENT](../docs/deployment/DEPLOYMENT.md#environment-variables). Never commit a real value.

## Commands

| Command                                                     | Does                                                                                                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                               | Dev server on http://localhost:3000 (`-- --port N --env-file <file>` to change)                                                                                            |
| `npm run build`                                             | Production build (`shopify hydrogen build --codegen`)                                                                                                                      |
| `npm run preview`                                           | Production-mode server (`shopify hydrogen preview --build`)                                                                                                                |
| `npm run lint`, `npm run typecheck`, `npm run format:check` | Static checks                                                                                                                                                              |
| `npm run test`                                              | Vitest (unit and integration); `test:watch`, `test:coverage`                                                                                                               |
| `npm run e2e`                                               | Playwright; see [PLAYWRIGHT_WORKFLOW](../docs/testing/PLAYWRIGHT_WORKFLOW.md) for the switches (`E2E_PORT`, `E2E_ALL_BROWSERS`, `E2E_PROTECTION_FLAG`, `E2E_PROD_PREVIEW`) |
| `npm run codegen`                                           | Regenerate Storefront and Customer Account API types                                                                                                                       |
| `npm run check`                                             | Format check, lint, typecheck, tests and build                                                                                                                             |

## Layout

`app/routes/` routes; `app/lib/` framework-free logic (catalog, offers, offers-runtime, delivery, extend, detective, quiz, stores, seo, logging); `app/components/` UI; `server.ts` the server entry (applies security headers to every response); `tests/` unit, integration and e2e. Platform-specific code is limited to `server.ts`, `app/lib/context.ts` and the `oxygen()` plugin in `vite.config.ts` (ADR-0004). `guides/`, `AGENTS.md`, `.cursor/` and `CHANGELOG.md` are template material kept for reference.

## Customer Account API (`/account`)

The account area is unfinished (P6-07). To use the template's sign-in locally, follow steps 1 and 2 of <https://shopify.dev/docs/custom-storefronts/building-with-the-customer-account-api/hydrogen#step-1-set-up-a-public-domain-for-local-development>. Not verified on a store.
