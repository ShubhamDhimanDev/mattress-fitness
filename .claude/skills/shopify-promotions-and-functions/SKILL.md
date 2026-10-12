---
name: shopify-promotions-and-functions
description: "Implements gift-with-purchase, bundle savings, add-on offer rules, Shopify Functions and post-purchase offers, choosing native Shopify discounts first and using a Function or extension only when the store's plan and distribution model are verified eligible. Use for REQ-PROMO, REQ-POST and haul-away enforcement, and before promising anything inside checkout."
---

# Shopify promotions and Functions

## When to use

Configuring or coding gifts, bundles, offer rules, haul-away enforcement, post-purchase offers, or any discount behaviour; evaluating whether a Function or extension is possible for this store.

## Steps

1. **Prefer native discounts.** Gift with purchase and bundles are Shopify discounts (automatic where possible) so the cart and checkout agree. Verify on the development store (V-03): automatic discount applies in a Storefront API cart, appears identically at checkout, how many can be active, how it combines with codes. If a client rule cannot be expressed natively, raise a change request; do not compute prices in the storefront.
2. **Check eligibility before any Function or extension.** Facts to date: Functions in a *custom* app require Shopify Plus; Functions in a public App Store app work on any plan; post-purchase extensions need an access request for live stores and custom apps are Plus-only; headless support is undocumented (F-07, F-08). Confirm the client's plan (V-01) and read the current docs. If ineligible, the requirement stays **Blocked** and the documented fallback is used (server-side enforcement plus reconciliation, Q-006, Q-007).
3. **Function work (only if eligible).** Put it in `shopify-app/` (a Shopify app project), scaffold with the Shopify CLI, implement the narrowest Function that does the job (for example cart and checkout validation for the haul-away maximum), unit-test the logic with Shopify's documented test tooling (check the current command in the docs), keep scopes minimal, never put secrets in the extension.
4. **Post-purchase (only if eligible and enabled).** Submit the access request early (review can take up to seven days); build on a development store first; define what is offered, the decline path and tracking.
5. **Record and configure.** Document each promotion and rule (name, trigger, benefit, dates, who can change it) in the configuration spec and the admin guide; offer rules stay data in Shopify, not code.
6. **Test.** Unit tests for rule evaluation; integration on the development store for the discount behaviour; e2e for add, remove qualifying item, change size, and over-limit attempts; manual comparison of cart and checkout totals.

## Outputs

Discount and rule configuration specs, Function or extension code (if built) with tests, an eligibility record with sources and dates, the fallback decision where ineligible, and admin-guide notes.

## Validation

Cart total equals checkout total for each promotion; removing the qualifying item removes the gift and its discount; a Function (if built) blocks the over-limit case and can be deactivated in admin; requirements that depend on an unverified or ineligible feature are marked Blocked with the reason, never faked.
