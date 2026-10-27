# Brand catalog (development store), rebuilt 2026-10-27

599 products from the 12 brands the store carries, with the makers' own descriptions and photos. Two files with the same source data:

| File | Format | Use |
|---|---|---|
| `brand-mattresses.shopify.csv` | the 47-column layout of Shopify's own product export | Shopify admin, Products, Import. **Everything**: 599 products, 5,843 variants, up to 8 photo URLs each |
| `brand-mattresses.csv` | the project sheet ([../README.md](../README.md)) | `validate.mjs`, then `import.mjs`: also sets the comfort, type, height and brand fields the storefront filters read. Holds only what that sheet can describe (see below) |
| `review-notes.csv` | handle + note | What was assumed, derived or left out, per product |
| `images/` (not in git, 2,530 files, 911 MB) | photos named `<handle>-<n>.<ext>` | the file names the project sheet lists |

## What is in it

| Brand | Source | Products | Notes |
|---|---|---|---|
| Tempur-Pedic | product pages (embedded product data) | 56 | list (retail) price, not the current promotion |
| Stearns & Foster | product pages | 16 | |
| Sealy | product pages | 12 | 5 mattress models, a pillow, a bundle and a foundation have no price on the site and are left out |
| Molecule | Shopify feed | 24 | |
| Serta | product pages | 127 | |
| Brooklyn Bedding | Shopify feed | 54 | |
| **Helix** | read in a browser, one page at a time | **19** | **Partial.** 19 mattresses (Original, Plus, Luxe and Elite lines) and nothing else: the site cut the connection after about 20 pages. Helix's other 47 product pages (Plus Luxe and Elite, Birch, kids, crib, protectors, pillows, bases, frames) are not in the files |
| Puffy | Shopify feed | 23 | |
| Beautyrest | product pages | 117 | |
| Aireloom | product pages | 34 | **Queen only**: the site shows one price per model ("Queen starting at ...") |
| Kingsdown | Shopify feed | 42 | |
| Casper | Shopify feed | 75 | the 129 bundle listings are left out (bundle prices come from Shopify discounts) |

By type: 278 mattresses, 118 pillows, 55 accessories, 33 bedding, 27 sheets, 25 adjustable bases, 17 foundations, 17 protectors, 14 toppers, 12 frames and furniture, 3 pet beds. Left out: gift cards, fees, haul-away and removal services, protection plans, bundles, products with no price (discontinued or in-store only), and 70 old URLs that now show the same product as another page.

## How it was collected

- Public pages and feeds only, one request at a time per site, the site's own crawl delay where it states one (10 seconds for Serta and Beautyrest), honest user agent, and only paths each site's robots.txt allows. Tempur-Pedic, Stearns & Foster and Sealy allow all crawlers. Aireloom has no robots.txt.
- **Helix** answers plain requests with 403 (bot protection) and does serve its pages to a browser. They were read by loading each page in a browser like a visitor. Automated requests to Helix, including from inside the browser, were refused and not retried or worked around. When the connection started dropping the reading was stopped.
- Raw pages and feeds are kept in `.scrape/` (not in git) so the parsers can be changed without fetching again.
- **Texts and photos are the makers'.** Per the owner on 2026-10-27, the descriptions, feature lists and photos are copied as published (this replaces the first pass, which wrote its own text and used placeholders). The Shopify sheet points at the makers' image URLs (Shopify copies the file on import); the downloaded copies in `images/` are for the project sheet. **The client needs the brands' permission to use this material before it goes live.**

## What to know before using it

- **Everything is a draft.** `Status` is `draft` and `Published` is `false` (project sheet: `copy_approved` is `no`), because no copy is client-approved yet.
- **Prices are the makers' list prices on 2026-10-27, for reference.** For Tempur-Pedic, Stearns & Foster and Sealy it is the retail price, not the promotion shown that day. Helix's list price is the regular price, not its 20% sitewide offer. Brooklyn Bedding's feed and page show prices at two thirds of round numbers (for example $265.33 for a $398 item) with no struck-through price; they are used as shown. The retailer sets its own prices, and some makers have minimum advertised price rules.
- **Serta and Beautyrest:** 45 products have several configurations per size (for example firm, medium and plush). The names of the second option are drawn by JavaScript on the maker site and are not in the page, so they are labelled `Part <number>` (the SKU's part number). Someone has to rename them in Shopify admin.
- **Comfort, type, height** come from the source text when it states them. Where it does not, the project sheet assumes Medium (171 models) or Foam (10 models) and leaves the height blank (294 models); `review-notes.csv` lists each one. Sleep positions are derived from the comfort level, benefits only from words in the source text, delivery type is `both`, and the related add-ons are the sample handles of the offer setup.
- **The project sheet has 576 models, over the 400 of the agreed scope** (validator warning `W_OVER_MODEL_LIMIT`). It has one model per combination of the options other than size (for example Firm and Medium of one Brooklyn Bedding model), because the sheet allows only one option. The Shopify sheet keeps the options as the makers have them (up to 3, up to 100 variants a product). Importing everything is a scope decision for the owner (change request, SOW section 11).
- **The project sheet leaves out** products with no size option (most pillows), with non-bed sizes, and with more than 8 option combinations: 264 of the 599 products are only in the Shopify sheet. Split sizes other than Split California King are left out of it too.
- `node scripts/catalog/validate.mjs brand-mattresses.csv --images images` reports **0 errors, 2,294 warnings** (copy not approved, many photos shared by the split models, heights missing, and a few price-order notes that are the makers' data).
- The brand entries (`seed-entries.mjs`) now cover all 12 brands. The importer links a product to its brand by the slugged brand name (`stearns-and-foster`).

## Running it again

```
node scripts/catalog/scrape/shopify-feed.mjs scripts/catalog/brand-catalog/.scrape/raw     # the 5 Shopify feeds
node scripts/catalog/scrape/pages.mjs scripts/catalog/brand-catalog/.scrape/pages <brand>  # tempur-pedic stearns-foster sealy beautyrest serta aireloom
node scripts/catalog/scrape/build.mjs                                                       # both sheets and the notes
node scripts/catalog/scrape/download-images.mjs && node scripts/catalog/scrape/build.mjs   # photos, then the project sheet lists the ones that exist
```

Helix records are JSON files in `.scrape/pages/helix/` (`helix-browser.mjs` is a standalone version of the reader; it is refused by Helix's bot protection, so the records were taken from an ordinary browser session).
