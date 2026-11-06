# Policy pages (copied from the reference site at the owner's request)

**Deviation from NFR-007.** NFR-007 (confirmed, SOW §1 and §13) says no text from the reference site. On 2026-11-06 the owner
chose to copy the policy pages of mattresswarehouse.com anyway ("copy them, and just leave warranty sections, and the brands we
dont have"). Recorded as DEC-152 in `progress/DECISIONS.md`. The text is another company's legal copy, so the client's lawyer
should read it before it goes live.

Source pages (read 2026-11-06): `/pages/privacy-policy`, `/warranty-and-return-policy`, `/pages/website-accessibility`,
`/pages/submission-policy`. Nothing is published yet: the site reads policies from Shopify, and nothing here was sent to the
store. Paste each file in Shopify admin and check the page in the storefront.

| File | Where it goes in Shopify admin | Shows on the storefront at |
|---|---|---|
| `privacy-policy.html` | Settings > Policies > Privacy policy | `/policies/privacy-policy` |
| `refund-policy.html` | Settings > Policies > Refund policy | `/policies/refund-policy` |
| `website-accessibility.html` | Online Store > Pages, handle `website-accessibility` | `/pages/website-accessibility` |
| `submission-terms.html` | Online Store > Pages, handle `submission-policy` | `/pages/submission-policy` |

The footer's legal links show a policy or page only once it exists and has content (P6-09).

## Publishing with the script (instead of pasting)

`scripts/setup/seed-policies.mjs` writes all four to a store: the two policies with `shopPolicyUpdate`, the two pages with
`pageCreate` or `pageUpdate` (matched by handle, so a second run updates and never duplicates). It overwrites the store's
current privacy and refund policy text. Needs the scopes `write_legal_policies` and `write_content`.

```
bash scripts/setup/with-admin-token.sh node scripts/setup/seed-policies.mjs                              # dry run, sends nothing
bash scripts/setup/with-admin-token.sh node scripts/setup/seed-policies.mjs --live --allow-placeholders  # development store
bash scripts/setup/with-admin-token.sh node scripts/setup/seed-policies.mjs --live                       # refuses while any [CONFIRM: ...] is left
```

Not yet run against any store (unverified). Run the dry run first, then the development store, then look at `/policies/privacy-policy`,
`/policies/refund-policy`, `/pages/website-accessibility` and `/pages/submission-policy`. The production store is only written once every
`[CONFIRM: ...]` is answered and the owner has approved the text.

## What was changed from the source

- The company name is Mattress Fitness; the website is www.mattressfitness.com; the address and phone are the ones in
  `storefront/app/lib/business.ts` (24324 Northwest Freeway, Suite 200, Cypress, TX 77429; (281) 758-5279).
- **Left out, as asked:** every warranty section of the returns page (file a warranty claim, warranty coverage, extended
  warranty with its Extend blurb). The returns page is published as the refund policy without them.
- **Left out because the store does not do it (the "brands we don't have" rule, applied to services):** the Hotjar and Adobe
  Analytics paragraphs (this storefront has neither), and the whole "Mobile Terms & Conditions" text-message section (the
  store's text-message signup is off, and the short code 21048 is the reference company's). Add an SMS section when SMS is
  approved and the store has its own number. No brand names appear in these four pages.
- Their "submit a privacy inquiry" link and their customer-service email were removed; PowerReviews is replaced by a placeholder.
- The shipping policy and the terms of service have no page on the reference site, so there is nothing to copy for them.

## What must be answered before going live

Search each file for `[CONFIRM:`. These are facts that belong to the reference company and that I cannot know for the client:

- Privacy: effective date; governing state for the arbitration clause (the source says Maryland); a privacy-requests email;
  whether the store sends direct mail.
- Refund policy: the source says "strict no-return policy" while this site's banner says "365 Night Sleep Trial" and "100%
  Comfort Guarantee", so one of them is wrong for this store; the 120 nights and 30 nights of the comfort exchange, the 3-week
  refund time, the 24-hour cancellation window and the 20% restocking fee are all the reference company's numbers.
- Accessibility: a customer-service email.
- Submission terms: the reviews provider's company name (twice).
