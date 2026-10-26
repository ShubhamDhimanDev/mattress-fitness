# Brand mattress catalog (development store), 2026-10-26

58 mattress models and 310 size rows for the brands the store carries: **Puffy** (5 models), **Molecule** (17), **Beautyrest** (17) and **Serta** (19). Two files with the same content:

| File | Format | Use |
|---|---|---|
| `brand-mattresses.csv` | the project sheet ([../README.md](../README.md)) | `node scripts/catalog/validate.mjs`, then `import.mjs`: sets the comfort, type, height and brand fields the storefront filters and spec tables read |
| `brand-mattresses.shopify.csv` | the column layout of Shopify's own product export (the 47-column file the owner attached) | Shopify admin, Products, Import. It cannot set custom metafields or the brand reference |

`node scripts/catalog/validate.mjs brand-mattresses.csv --images <folder>` reports **0 errors, 38 warnings** (40 models have no height because the source does not state one, a few size-order and SEO-length notes, and the unapproved-copy note). The Shopify-format file is made from the project sheet with `node scripts/catalog/to-shopify-csv.mjs <sheet> <out>`.

## Where the facts came from, and what was not taken

Collected on 2026-10-26 from public pages, one request every 10 seconds (the Beautyrest and Serta crawl delay), only paths each site's robots.txt allows:

- **Puffy and Molecule:** the stores' public `products.json` feeds: model names, sizes, the listed price per size, and Puffy's size and thickness strings.
- **Beautyrest and Serta:** the schema.org product data embedded in each product page (name and price per size); for Beautyrest also the feel its collection page states.
- **3Z Brands (3zbrands.com) is not in the files.** The site is a portfolio of six brands (Helix Sleep, Brooklyn Bedding, Birch, Bear, Nolah, Leesa) with no product list and no prices, so there was nothing to take. Those brands' own sites would be the source.
- **Not taken:** the sites' descriptions, images, logos, reviews and marketing text. Each description is one plain sentence written from the facts, and every image name is a placeholder (the dev store import used labelled placeholder pictures). `copy_approved` is `no` for every model, so the importer creates them as drafts until the client approves the text.

## What the client must confirm before launch

- **Prices are the makers' listed prices on 2026-10-26, for reference.** For models sold in several feels or heights the lowest price per size is used. The retailer sets its own prices, and some makers have minimum advertised price rules. Two Serta 2023 models list a Full cheaper than a Twin XL; that is the source's data.
- **Split sizes are left out** (Split Head Queen, Split Head King, Split King): the project's size list has Split California King only, and no source sells it.
- **Assumed values** (the source does not state them, marked *assumed* below): the comfort level, the mattress type of Molecule's non-hybrid models (memory foam), of Beautyrest's Level One, Level Two and World Class models (innerspring) and of Serta's Classic and Five Star (innerspring), iComfort (memory foam) and iComfortPro (latex) lines; the sleep positions (derived from the comfort level: plush sides, medium back and side, firm and extra firm back and stomach); the delivery type (`both` everywhere); and the related add-on handles (the sample products of the offer setup).
- Benefits are filled only where the source text names them (Cooling, Pressure Relief, Back Support; Motion Separation on Beautyrest Black).

## Model list

| Handle | Brand | Comfort | Type | Height (in) | Sizes |
|---|---|---|---|---|---|
| puffy | Puffy | Medium *(assumed)* | Foam | 10 | 6 sizes |
| puffy-lux-hybrid | Puffy | Medium *(assumed)* | Hybrid | 12 | 6 sizes |
| puffy-royal-hybrid | Puffy | Medium *(assumed)* | Hybrid | 14 | 6 sizes |
| puffy-monarch-hybrid | Puffy | Medium *(assumed)* | Hybrid | 16 | 4 sizes |
| puffy-legacy-hybrid | Puffy | Medium *(assumed)* | Hybrid | 16 | 4 sizes |
| molecule-core-10 | Molecule | Medium *(assumed)* | Memory Foam | 10 | 6 sizes |
| molecule-core-hybrid-10 | Molecule | Medium *(assumed)* | Hybrid | 10 | 6 sizes |
| molecule-copperwell-12 | Molecule | Medium *(assumed)* | Memory Foam | 12 | 6 sizes |
| molecule-copperwell-hybrid-13 | Molecule | Medium *(assumed)* | Hybrid | 13 | 6 sizes |
| molecule-reflex-11 | Molecule | Firm | Memory Foam | 11 | 6 sizes |
| molecule-reflex-hybrid-11 | Molecule | Firm | Hybrid | 11 | 6 sizes |
| molecule-reflex-pro-12 | Molecule | Firm | Memory Foam | 12 | 6 sizes |
| molecule-reflex-pro-hybrid-12 | Molecule | Firm | Hybrid | 12 | 6 sizes |
| molecule-reflex-elite-14 | Molecule | Firm | Memory Foam | 14 | 6 sizes |
| molecule-reflex-elite-hybrid-14 | Molecule | Firm | Hybrid | 14 | 6 sizes |
| molecule-engage-12 | Molecule | Medium *(assumed)* | Memory Foam | 12 | 5 sizes |
| molecule-engage-hybrid-12 | Molecule | Medium *(assumed)* | Hybrid | 12 | 5 sizes |
| molecule-engage-pro-13 | Molecule | Medium *(assumed)* | Memory Foam | 13 | 5 sizes |
| molecule-engage-pro-hybrid-13 | Molecule | Medium *(assumed)* | Hybrid | 13 | 5 sizes |
| molecule-engage-pro-hybrid-12 | Molecule | Medium *(assumed)* | Hybrid | 12 | 5 sizes |
| molecule-engage-elite-14 | Molecule | Medium *(assumed)* | Memory Foam | 14 | 4 sizes |
| molecule-engage-elite-hybrid-14 | Molecule | Medium *(assumed)* | Hybrid | 14 | 4 sizes |
| beautyrest-black-series-one | Beautyrest | Extra Firm | Innerspring | not stated | 5 sizes |
| beautyrest-black-series-two | Beautyrest | Firm | Innerspring | not stated | 5 sizes |
| beautyrest-black-series-three | Beautyrest | Extra Firm | Innerspring | not stated | 5 sizes |
| beautyrest-black-series-four | Beautyrest | Firm | Innerspring | not stated | 5 sizes |
| beautyrest-black-hybrid-series-one | Beautyrest | Firm | Hybrid | not stated | 5 sizes |
| beautyrest-black-hybrid-series-three | Beautyrest | Firm | Hybrid | not stated | 5 sizes |
| beautyrest-black-hybrid-series-four | Beautyrest | Firm | Hybrid | not stated | 5 sizes |
| beautyrest-black-hybrid-series-three-xcs | Beautyrest | Medium *(assumed)* | Hybrid | not stated | 4 sizes |
| beautyrest-black-hybrid-series-four-xcs | Beautyrest | Medium *(assumed)* | Hybrid | not stated | 4 sizes |
| beautyrest-black-hybrid-series-five-xcs-plush | Beautyrest | Plush | Hybrid | not stated | 4 sizes |
| beautyrest-level-one | Beautyrest | Medium *(assumed)* | Innerspring | not stated | 6 sizes |
| beautyrest-level-two | Beautyrest | Medium *(assumed)* | Innerspring | not stated | 6 sizes |
| beautyrest-world-class-level-three | Beautyrest | Medium *(assumed)* | Innerspring | not stated | 6 sizes |
| beautyrest-world-class-level-four | Beautyrest | Medium *(assumed)* | Innerspring | not stated | 6 sizes |
| beautyrest-world-class-hybrid-level-three | Beautyrest | Medium *(assumed)* | Hybrid | not stated | 6 sizes |
| beautyrest-beautysleep-soothing-nights | Beautyrest | Firm *(assumed)* | Foam | not stated | 6 sizes |
| beautyrest-beautysleep-dream-weaver | Beautyrest | Medium *(assumed)* | Innerspring | not stated | 6 sizes |
| serta-classic-mattress-standard | Serta | Medium *(assumed)* | Innerspring | not stated | 6 sizes |
| serta-classic-mattress-enhanced | Serta | Medium *(assumed)* | Innerspring | not stated | 6 sizes |
| serta-five-star | Serta | Medium *(assumed)* | Innerspring | not stated | 6 sizes |
| serta-icomfort-mattress-standard | Serta | Medium *(assumed)* | Memory Foam | not stated | 5 sizes |
| serta-icomfortpro-mattress-level-two | Serta | Medium *(assumed)* | Latex | not stated | 4 sizes |
| serta-icomfortpro-mattress-level-three | Serta | Medium *(assumed)* | Latex | not stated | 4 sizes |
| serta-iseries-nxg-mattress-1500-hybrid-firm | Serta | Firm | Hybrid | not stated | 5 sizes |
| serta-iseries-nxg-mattress-2500-hybrid | Serta | Medium *(assumed)* | Hybrid | not stated | 5 sizes |
| serta-iseries-nxg-mattress-3500-hybrid | Serta | Medium *(assumed)* | Hybrid | not stated | 5 sizes |
| serta-iseries-nxg-mattress-3500-medium-foam | Serta | Medium | Memory Foam | not stated | 5 sizes |
| serta-iseries-nxg-mattress-4500-ultra-plush-foam | Serta | Ultra Plush | Memory Foam | not stated | 5 sizes |
| serta-perfect-sleeper-hybrid | Serta | Medium *(assumed)* | Hybrid | not stated | 6 sizes |
| serta-perfect-sleeper-hybrid-mattress-2023-version | Serta | Medium *(assumed)* | Hybrid | not stated | 6 sizes |
| serta-perfect-sleeper-innerspring-mattress-cascade-ridge-plush-12-5 | Serta | Plush | Innerspring | 12.5 | 6 sizes |
| serta-perfect-sleeper-innerspring-mattress-2023-version | Serta | Medium *(assumed)* | Innerspring | not stated | 6 sizes |
| serta-perfect-sleeper-innerspring-mattress-cascade-canyon | Serta | Medium *(assumed)* | Innerspring | not stated | 6 sizes |
| serta-perfect-sleeper-innerspring-mattress-cascade-range | Serta | Medium *(assumed)* | Innerspring | not stated | 6 sizes |
| serta-perfect-sleeper-x-quilted-hybrid-mattress-level-one | Serta | Medium *(assumed)* | Hybrid | not stated | 5 sizes |
| serta-perfect-sleeper-x-quilted-hybrid-mattress-level-two | Serta | Medium *(assumed)* | Hybrid | not stated | 5 sizes |
