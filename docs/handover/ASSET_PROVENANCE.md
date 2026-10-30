# Asset and copy provenance

Deliverable H-09 (task P8-07; requirements NFR-007, assumption ASM-04). **Draft 1, dated 2026-10-26, branch `feat/remaining-scope-fast`.** Records where every asset and block of copy in the repository came from, who holds the rights, and what still needs the client's confirmation. Written by the technical writer from a search of the repository on this date; **the independent review that P8-07 assigns to the code-reviewer has not happened**, so this is the inventory that review starts from, not its result.

Tags: `[verified]` (seen in the repository on this date), `[assumed]`, `[client input needed]`. Status words: **CONFIRMED** (source and rights recorded), **OWN WORK** (made by this project), **SYNTHETIC** (invented for tests and demos; never launch content), **NEEDS CONFIRMATION** (the client must confirm), **NOT PRESENT**.

## 1. The rule and how it was checked

NFR-007: no text, images, logos or trademarks from the reference site (SOW section 1 names mattresswarehouse.com); only the client's brand and manufacturer-supplied assets. ASM-04: the client holds the rights to all images and text it supplies. The SOW and the owner's instruction (ASM-08) say the site follows the layout and function of the reference site.

**Method used by the project (observation only).** The design notes in [REFERENCE_PATTERNS](../design/REFERENCE_PATTERNS.md) describe structure and behaviour in our own words. They were made on 2026-10-11 from the text of three pages (home, a collection, a product) and on 2026-10-22 from pages viewed in an isolated headless browser and measured with read-only queries (box sizes, grid tracks). Screenshots were viewed in a session scratchpad and **never stored in the repository**. Nothing was submitted, added to a cart or signed in. No wording, brand or product names, images, markup or styles were recorded, and the reference site's exact colour values were deliberately not recorded or matched ([BRAND_APPLICATION_SPEC](../design/BRAND_APPLICATION_SPEC.md) "IP rule"). Where our hue resembles the reference's red accent, the cause is the client's own logo (red `#DE0510`, taken from the logo supplied 2026-10-22).

**What this review checked on 2026-10-26 (`[verified]`):**

| Check | Result |
|---|---|
| Search of the whole repository (excluding `node_modules` and `.git`) for the reference site's name | Two hits, both documents: `docs/requirements/SCOPE_OF_WORK.md` (the SOW's own sentence) and `docs/requirements/OPEN_QUESTIONS.md`. **No hit in `storefront/`, `scripts/`, `deploy/` or `docs/design/`** |
| Files of type image (png, jpg, jpeg, svg, webp, gif, ico), font (woff, woff2, ttf, otf) or video in `storefront/app/`, `scripts/`, `deploy/`, `docs/`, `plans/`, `progress/` | None |
| Files in `storefront/public/` | `.gitkeep` and five resized logo PNGs (section 2) |
| Hot-linked remote images or fonts in `storefront/app/` (a URL ending in an image or font extension) | None in application code; the only hits are `https://cdn.example.com/...` strings inside a unit test |
| Font loading (`@font-face`, Google Fonts, `@fontsource`) in `storefront/` | None found; the stack is the visitor's system fonts ([BRAND_TOKENS](../design/BRAND_TOKENS.md) "Provenance") |
| Short generic labels that also appear on the reference site | Four, found by the earlier observation pass, still present in the code; listed in section 5 (N-5) for the owner's sign-off. The observation pass recorded nothing longer; this review had no copy of the reference text to compare against and did not look for more |

**What this review did not check:** that fictional names are not someone's real trademark (section 4); the licences of npm dependencies; whether text written by this project accidentally resembles a competitor's wording beyond what the authors observed; the contents of Shopify, which is where product images and client copy will live.

## 2. Inventory: files

| # | Asset | Path | Source | Rights | Status |
|---|---|---|---|---|---|
| F-1 | Logo master, 1254 x 1254 PNG, 543 kB, no transparent pixels | `storefront/brand-source/mattress-fitness-logo-original.png` (outside `public/`, never served) | Supplied by the client's owner in the project chat, 2026-10-22 `[verified]` (brand-source README, `app/lib/brand.ts`, BRAND_TOKENS) | The client's own artwork. No separate licence document has been seen | **CONFIRMED as source; NEEDS CONFIRMATION of rights in writing** (ASM-04) |
| F-2 | Logo copies 512, 256, 180, 96 and 48 px | `storefront/public/brand/mattress-fitness-logo-{512,256,180,96,48}.png` | Resized from F-1 with System.Drawing, artwork unchanged (no recolour, redraw or crop) `[verified]` (README, BRAND_TOKENS). Not re-derived byte by byte in this review | As F-1 | Same as F-1 |
| F-3 | Favicon and touch icon | The 48 px and 180 px logo copies, linked in `app/lib/brand.ts` | From F-2 | As F-1 | Same as F-1 |
| F-4 | Brand red and white (`#DE0510` and white) | `storefront/app/styles/tailwind.css` | Sampled from F-1 (dominant pixel `rgb(222,5,16)`) `[verified]` per BRAND_TOKENS | Client's brand colour | CONFIRMED as source |
| F-5 | Other palette values: lightness steps of the red, greys (`ink-*`), amber accent, sale, status and focus colours | `storefront/app/styles/tailwind.css` | Made up by this project; placeholders until the brand kit (CLR-013) | OWN WORK | **NEEDS CONFIRMATION**: replace with the client's palette |
| F-6 | Fonts | none loaded; system font stack | n/a | n/a | NOT PRESENT. The client's brand fonts (CLR-013) are not supplied; if added: self-host WOFF2, record the licence here |
| F-7 | Icons | `storefront/app/components/ui/Icons.tsx` | Drawn for this project (24 px stroke); no icon library `[verified]` per BRAND_TOKENS | OWN WORK | CONFIRMED |
| F-8 | Photography, lifestyle photos, product and brand images | none in the repository | Will come from the client and manufacturers through Shopify (SOW section 8; CLR-013, CLR-014) | Client holds rights (ASM-04) | NOT PRESENT; **NEEDS CONFIRMATION** per image batch (manufacturer licence terms for web use) |
| F-9 | Sample image file names | `scripts/catalog/sample/images.txt`, `offer-images.txt` | Lists of invented names; **no image files exist** | SYNTHETIC | CONFIRMED |
| F-10 | Brand "wordmark text beside the logo" | not built (BV-011, deferred) | n/a | n/a | NOT PRESENT |

## 3. Inventory: copy and data

| # | Item | Where | Source | Rights | Status |
|---|---|---|---|---|---|
| C-1 | Brand name "Mattress Fitness" and tagline "Rest. Recover. Perform." | `app/lib/brand.ts` | The client's name; the tagline is printed on the client's logo | Client | **NEEDS CONFIRMATION**: may the tagline stay as live footer text? (open question Q4 in BRAND_APPLICATION_SPEC, UXD-23, B-28) |
| C-2 | Storefront interface text (buttons, labels, messages, empty states, error text, accessibility names) | `storefront/app/**` | Written by this project | OWN WORK | See section 5 for the labels that also appear on the reference site |
| C-3 | Consent banner and preferences wording | `storefront/app/**` (consent layer) | Our draft, no legal review | OWN WORK | **NEEDS CONFIRMATION**: client counsel (Q-012, T-16) |
| C-4 | Email signup consent sentence (version `email-v1`) and SMS wording | `storefront/app/lib/signup/` | Our draft; a production build also requires the SMS wording to be client-approved in code | OWN WORK | **NEEDS CONFIRMATION**: counsel and client (B-33 item 3) |
| C-5 | Default sleep quiz: eight questions, answers and weights | `storefront/app/lib/quiz/default-config.ts` | Written by this project as a draft for approval | OWN WORK | **NEEDS CONFIRMATION**: client approval (CLR-012) |
| C-6 | Placeholder offer wording (comfort guarantee, free delivery, gift, bundle, haul-away) | `storefront/app/**`, `OFFER_CONFIG_JSON` examples | Written by this project; placeholder pending the client's rules and wording (CLR-010, CLR-011) | OWN WORK | **NEEDS CONFIRMATION**: client wording. Header guarantee strip is hidden (`awaitingContent`) until supplied; footer guarantee pages appear only when the client creates them |
| C-7 | The 15 content pages (delivery and shipping, financing, comfort guarantee, price guarantee, warranty and returns, FAQ, about, contact, size guide, comfort guide, mattress types guide, adjustable base guide, privacy policy, terms, accessibility) | **Not in the repository.** Page layouts only; [CONTENT_PAGES](CONTENT_PAGES.md) is guidance for the client's writers, not page text | The client supplies the text (SOW section 8, CLR-016) | Client | NOT PRESENT; each page must be approved before it is made visible |
| C-8 | Drafted product copy (descriptions, bullets, SEO titles, meta descriptions) | none yet; the sample sheet text is invented | To be drafted from the client's facts and manufacturer specifications only (SOW section 8; EXC-10); approval status per product (CLR-017) | Client approves | NOT PRESENT |
| C-9 | Documents under `docs/`, `plans/`, `progress/` | repository | Written by this project's team | OWN WORK | CONFIRMED; internal; the handover subset is H-01 to H-09 |
| C-10 | Reference-site notes | `docs/design/REFERENCE_PATTERNS.md` | Our own description of structure and behaviour (section 1) | OWN WORK | CONFIRMED by method; **independent review pending** |

## 4. Inventory: sample, fixture and demo data

All of this is invented and must never be shown to shoppers or the client as their catalog (DEC-077).

| # | Item | Path | Content | Status |
|---|---|---|---|---|
| D-1 | Sample product sheets | `scripts/catalog/sample/mattresses.csv`, `invalid.csv`, `offer-products.csv` | Invented brands (for example Cloudmere, Tidewell, Ashgrove, Verdant, Everyday, Quillmoor Sleep, Brindlewood Bedding), models, prices, descriptions marked "made-up sample copy". The CSV header row is the product contract of this project | SYNTHETIC |
| D-2 | Catalog fixtures | `storefront/app/lib/catalog/fixtures.ts` | Invented brands, lines and models; image URLs on the reserved `.test` domain that never resolve; fake variant IDs | SYNTHETIC |
| D-3 | Store fixtures (removed 2026-10-28, DEC-141: `storefront/app/lib/stores/fixtures.ts` no longer exists) | none | Was: invented store names, placeholder streets and phone numbers in the fiction range 555-01xx | REMOVED |
| D-4 | Test fixtures and e2e data | `storefront/tests/**`, `storefront/app/**/*.test.*` | Invented names, addresses and order numbers; example domains | SYNTHETIC |
| D-5 | Example offer configuration | `docs/integrations/OFFER_SETUP_DEVSTORE.md`, test files | Fake Shopify IDs and made-up rules (DEC-082) | SYNTHETIC |
| D-6 | Mock-store data | read live from `mock.shop`, `bedding.mock.shop` during development | Shopify's public demo stores; nothing copied into the repository | Not in repository |
| D-7 | The owner's development store | `mattressfitness-1iakxuvz.myshopify.com` (one test product) | The owner's; read only | Not in repository |

**Risk to clear:** whether any invented brand or model name coincides with a real company's trademark was **not searched** (a name like "Cloudmere" or "Quillmoor" may exist somewhere). The fixtures say "fictional and must never look real" (NFR-007, data-source comment). Before the demo data is loaded on a store the client can see, a trademark search of the invented names is `[assumed]` prudent; or rename them. Owner decision.

## 5. Items needing client or owner confirmation

| # | Item | What is needed | From |
|---|---|---|---|
| N-1 | Logo rights (F-1 to F-3) | A short written statement that the supplied logo is the client's own and may be used in the repository and site; a transparent PNG or SVG is also requested (Q1 in BRAND_APPLICATION_SPEC) | Client |
| N-2 | Tagline "Rest. Recover. Perform." (C-1) | Written yes or no for live footer text; clear-space and usage rules for the logo | Client (Q4, B-28) |
| N-3 | Brand kit (F-5, F-6): palette, fonts, lifestyle photography | Supplied files plus licences (CLR-013) | Client |
| N-4 | Product images and manufacturer copy (F-8, C-8) | For each manufacturer: confirmation that the images and specifications may be used on the client's site; file names per product (SOW section 8) | Client |
| N-5 | Three generic labels also on the reference site: "Shop by size" (home size block heading and a footer group), "Continue shopping" (empty cart and delivery page buttons), "N Reviews" (card rating count), and "Shop now" (promo tile button) | The owner consciously signs these off as standard storefront vocabulary or asks for rewording. They are not distinctive phrasing (REFERENCE_PATTERNS "Generic UI labels"). Current occurrences in non-test code: `CartMain.tsx`, `PromoTileCard.tsx`, `delivery.tsx`, `navigation.ts`, `CatalogSections.tsx` (7 hits) | Project owner (NFR-007 sign-off) |
| N-6 | Consent, signup and SMS wording (C-3, C-4) | Counsel review | Client counsel |
| N-7 | Quiz questions and recommendation rules (C-5) | Approval | Client (CLR-012) |
| N-8 | Offer and guarantee wording (C-6) | Approval; rules (CLR-011) | Client |
| N-9 | Content page text (C-7) | Client supplies; approves before visible | Client (CLR-016) |
| N-10 | Invented names (D-1 to D-3) | Trademark search or rename (section 4) | Project owner |
| N-11 | Dependency licences | A licence check of npm dependencies before transfer; not done. The Hydrogen skeleton template is assumed to carry Shopify's open-source licence `[assumed]`; confirm and keep the licence file with the repository | Owner / devops |
| N-12 | Extend logo and terms; "Powered by Extend" (text only, no logo today) | Extend's permission and brand terms (Q-005) | Extend, client |
| N-13 | Third-party scripts and widgets (GA4, Meta, Klaviyo, chat, reviews) | Provider terms are the client's; none is bundled or shipped in the repository | Client |

## 6. Statement and sign-off

On 2026-10-26, by the searches listed in section 1, the repository contains **no file, image, font, logo or text identified as copied from the reference site**, and no file other than the client's logo and its resized copies is an image. Copy and tokens made by this project are its own work; invented sample data is marked synthetic. This statement rests on the method in section 1 and on the searches above; it is not a legal opinion and does not cover similarity of wording that nobody noticed.

| Step | Name | Date |
|---|---|---|
| Inventory drafted (technical-writer) | | 2026-10-26 |
| Independent copy and asset review (code-reviewer, P8-07) | `[to do]` | |
| Owner sign-off of N-5 labels and N-10 | `[to do]` | |
| Client confirmation of N-1 to N-4 and N-6 to N-9 | `[client input needed]` | |

Re-run the searches of section 1 on the release candidate (Phase 8 exit), and again if any asset or page text is added.

## What this document does not cover

Content that lives only in Shopify (product images, page text, blog articles): its provenance is the client's responsibility under ASM-04 and is checked at import (REQ-HAND-002) and content approval. Third-party service marks displayed by providers' own widgets.
