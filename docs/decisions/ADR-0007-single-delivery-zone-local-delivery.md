# ADR-0007: One delivery zone, stored once, enforced at checkout by Shopify Local delivery

- **Status:** Proposed (owner chose one zone on 2026-10-12; the checkout mechanism is our proposal, confirm in P3A-10 once the ZIP list arrives)
- **Date:** 2026-10-12
- **Deciders:** project owner; client (zone data); solution-architect
- **Requirements:** REQ-DEL-001, REQ-DEL-002, REQ-PRE-003, REQ-CHK-003, REQ-CHK-005
- **Related:** F-18, F-20, F-28, Q-008, SD-04, SD-07, R-09, R-22, [DELIVERY_ZONE_OPTIONS](../research/DELIVERY_ZONE_OPTIONS.md)

## Context

The SOW offers white-glove in-home delivery only inside the client's zip list, with a fee rule (free above a threshold, flat fee below). The owner reduced this to **a single zone for now**. On Basic we cannot run a Delivery Customization Function. Shopify's native ZIP gating is **Local delivery**: postal codes or a radius, per-zone price, optional minimum order, up to three extra price rules, no plan restriction stated. Its limits: it does not work with Apple Pay, Google Pay or PayPal in the first checkout step, items must all ship from one location, and it cannot be mixed with shipped items in one order (F-28). The Storefront API does not document reading delivery options for a bare ZIP (F-20).

## Decision

- Store the zone **once** as a `delivery_zone` metaobject (name, ZIP list, fee, free-over amount, promise text) read by the storefront for the header ZIP check, the product-page promise and the haul-away step.
- Configure **Shopify Local delivery** for the same ZIP list as the checkout mechanism. The zone price, minimum order and up to three extra price rules express "free above a threshold, flat fee below".
- A script and a CI test compare the metaobject list with the Local delivery postal codes (read by the Admin API if V-06c allows, otherwise compared against a documented export) so the two cannot drift silently.
- If the zone turns out to be **whole states**, replace Local delivery with a normal shipping zone and flat rate; the wallet limitation disappears.
- Express wallet buttons are not offered for qualifying carts; Shop Pay still works. This is SD-04.

## Consequences

Easier: no Function, native fee rules, single list for the client to maintain. Harder: two places hold the list (metaobject and Local delivery) until Shopify offers a read API; the 3,000 character limit caps the list (about 400 five-digit codes with separators, fewer with `*` prefixes helping); mixing parcel and in-home items needs a decision (Q-008 pack question).

## Alternatives considered

Native shipping profile rates without ZIP gating (works only for whole states). A Delivery Customization Function (Plus or public app). A third-party ZIP-restriction app (recurring fee, EXC-12). Storefront-only gating (no checkout enforcement, rejected under T-02).

## Verification

V-06a to V-06e on the dev store; parity test in CI; one test order in zone and one out of zone (REQ-ACPT-002); checkout screenshots showing the wallet behaviour for the client.
