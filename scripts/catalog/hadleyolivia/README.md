# Aireloom from Hadley Olivia (2026-11-12)

Owner request: add the 14 Aireloom mattress listings of hadleyolivia.com with two variation sets (Size and Foundation), their exact photos and videos, and the main image as on the website. Choice made by the owner: **replace the old Queen-only drafts**.

| File | What it is |
|---|---|
| `build.mjs` | turns the raw read of the 14 pages (`../brand-catalog/.scrape/hadleyolivia-raw.json`, git-ignored) into `aireloom-products.json` |
| `aireloom-products.json` | 14 products, 294 variants, 57 photos, 14 videos: the file `import.mjs` sends |
| `import.mjs` | dry run by default; `--live --expect-new N` writes; `--only <handle>` for one product |

## What was read, and how

- The collection page `/collections/aireloom` lists 15 products: 14 mattresses and one topper (the topper is not part of this request).
- Per product page, in a browser session: the JSON-LD `ProductGroup` (21 variants with their list prices), the media gallery in page order (the first is the main photo; each product has one video, whose file address is in the page), and the text tabs (Description, Key Features, Construction and Materials; the Product Summary and FAQ tabs are not used). Their robots.txt allows reading public product pages; the page reads were paced (one every 3.5 seconds), and the one `429` met at the start was waited out (`Retry-After`).
- **Sale:** all 14 pages carry "Save 20% Off In Cart" and show "Your price" as the list price less 20%. Here that is a plain sale price: price = list price less 20% (whole cents), compare-at = their list price, so the cards and the product page show "Save $X Today!" from Shopify's own price fields (`update-prices.mjs` applied it on 2026-11-12, 294 variants, idempotent).
- **Not copied:** their showroom and phone text, and their stock flags. Sizes: "Cal King" is written "California King" (the storefront's size words); "Split King" stays as they have it.
- Texts, photos and videos are the retailer's and the maker's, copied as published (owner decision 2026-10-27, as in `../brand-catalog/README.md`). **The client needs the brands' permission before this goes live.**

## What the import does to the store

- Creates each model ACTIVE with options Size (7) x Foundation (3: No Foundation, 9", 5.75"), SKUs `AIR-<MODEL>-<SIZE>-<FOUNDATION>`, the filter fields (comfort, type, sleep positions, benefits, height) from the maker data already in the catalog, and the Aireloom brand link, and publishes it to the channels the active Molecule mattresses are on.
- Photos are given to Shopify by their source address. Videos are downloaded and handed over through a staged upload (Shopify refuses a video given by another Shopify store's address).
- The 13 models that existed as Queen-only drafts: that draft is **archived** (reversible in admin) and, where it held the same address (6 cases), renamed `<handle>-queen-only` first. Nothing is deleted. The run manifest is in `../.runs/` (git-ignored) and lists the old and new handles.
- Run 2026-11-12 against `mattressfitness-1iakxuvz`: 14 created, 13 old drafts archived (the M2+ Plush is new).

Product page: the gallery now shows videos (query `media`, `GalleryMedia` in `lib/shopify/types.ts`), and the policy allows the store domain as a media source (`media-src`, `docs/security/SECURITY_HEADERS.md`).
