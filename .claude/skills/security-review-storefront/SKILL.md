---
name: security-review-storefront
description: "Reviews storefront changes against the project threat model (T-01 to T-16): price and offer tampering, webhook verification, secrets, PII in logs, XSS from CMS content, CSRF and redirects, guest lookup abuse, third-party scripts, account access, dependencies and AI-agent risks. Use at phase gates, for any change touching money, eligibility, accounts, webhooks, secrets or dependencies, and before release. Named to avoid the built-in security-review command."
---

# Storefront security review

## When to use

Gate G5 of any phase that touches the areas above; Phase 7 hardening (P7-07); a suspected leak. Model: `docs/security/THREAT_MODEL.md`; rules: `.claude/rules/security.md`.

## Steps

1. **Scope.** Identify the diff or files and map them to threat IDs in the model. Note what is out of scope for this review.
2. **Secrets.** Search the tree and history for tokens and keys (Shopify, Extend, Admin API, webhook secret); confirm only `.env.example` names exist; confirm no private variable is imported by client-reachable modules; inspect the built client bundle for private names. Never print a secret you find: report the location and recommend rotation.
3. **Money and eligibility (T-01, T-02, T-06).** Trace where prices, discounts, quantities and eligibility originate; prove the server recomputes from Shopify data; read the tamper tests and try the hostile cases (orphaned add-on, over-limit haul-away, stale quote, ineligible ZIP).
4. **Webhooks and sync (T-03).** HMAC on the raw body with constant-time compare, replay protection, idempotent processing, secrets server-only, bounded retries.
5. **Input and output (T-07, T-08).** Validation at every boundary; rich text sanitised; redirect allow-list; CSRF protection on actions; cookie flags.
6. **Data and logs (T-05, T-09, T-11).** No PII in logs or analytics payloads; ownership checks on account and order queries; guest lookup returns one generic failure, is rate limited and logs no personal data.
7. **Third parties and headers (T-10, T-16).** CSP and security headers; script origins allow-listed and consent-gated; no ZIP or email to third parties.
8. **Dependencies and tooling (T-12, T-15).** Run the audit; review new packages, Actions and MCP servers (pinned versions); confirm agent permission settings (deny `.env` reads, ask on deploys and pushes).
9. **Write the review** to `docs/security/REVIEW-<scope>.md`: findings ranked High, Medium, Low with threat ID, evidence, impact and fix; update the threat model's verification column; give a verdict.

## Outputs

A review note with evidence, updated threat-model status, and a gate verdict: pass, pass with accepted risks (needs the owner's written acceptance), or fail.

## Validation

Every applicable threat has a verification result or an approved risk acceptance; no unresolved High; no secret in the tree, history or bundle; negative tests exist for tampering, replay and cross-customer access and were run; you listed what you could not verify.
