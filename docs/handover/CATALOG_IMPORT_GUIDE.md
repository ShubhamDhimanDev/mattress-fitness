# Catalog import guide: the product sheet and the import tool

Deliverables H-02 and H-03 (tasks P3A-05 and P9-08; REQ-CAT-009, REQ-HAND-002). **Draft 1, dated 2026-10-26.** For the client's team. The exact column rules and the tool's own usage text are in [scripts/catalog/README.md](../../scripts/catalog/README.md); this guide is the step-by-step version and says what has and has not been proven. It was written from the README, `scripts/catalog/schema.mjs`, the tool's usage text and the sample files. Developer-side steps are in [RUNBOOKS](RUNBOOKS.md) section 7.

## Read this first: what has never happened

| Fact | Status |
|---|---|
| The validator and importer pass their tests against a **simulated Shopify** | `[verified]` by tests (the script tests were reported as 339 passing on 2026-10-26, orchestrator-reported, not re-run by the writer) |
| The importer has **never been run against a real Shopify store**, not even a dry run that reads | **True.** No Admin API token exists yet (B-27); the owner creates it after local development (DEC-076) |
| A live import (`--live`) has **never been run anywhere** | **True.** The first live run is a checklist item (P3A-05) and needs the written go-ahead for the target store |
| A non-developer has **never completed this guide** | **True.** The acceptance test is a clean run on your machine from a clean checkout (REQ-HAND-002); it is not done |
| The real product sheet | **Not supplied** (CLR-014, B-26). The only data we have is invented sample data in `scripts/catalog/sample/` (DEC-077). Never show it to shoppers as your catalog |
| What the importer needs in Shopify first (metaobject and metafield definitions, brand entries, Search and Discovery filters) | Written but unverified on a store (V-04, V-05) |

Everything below tagged `UNVERIFIED` is a statement about Shopify's behaviour we have not seen on a store.

## What the tool does and does not do

**Does:** reads your CSV, checks it against fixed rules, compares it with the store and makes the store match. One product per model, one variant per size. It is safe to re-run: handle and SKU are the keys, and a second run of an unchanged sheet shows only `unchanged`.

**Does not:**

- write anything unless you add `--live`;
- delete products, ever;
- delete sizes or images missing from the sheet unless you add `--allow-removals`;
- add the `offer-only` or `extend-coverage` tags (do that in Shopify admin, section 8 below);
- create brand entries, collections, filters or pages;
- undo a run (there is no revert tool; the run record lets a person restore values by hand).

## 1. What you need

| Need | Detail |
|---|---|
| Node.js 22 | `node --version` should print `v22...`. Nothing else is installed: the tools use only what Node includes `[verified]` (README) |
| A copy of the repository | Clean checkout of the client-owned repository (once it exists, Q-014) |
| The template | `scripts/catalog/template/products.csv` (open in Excel or Google Sheets) |
| Images | One folder; file names exactly as written in the sheet. Formats `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`. Each file at most 20 MB (the 20 MB figure is from Shopify's help pages and is `UNVERIFIED`, V-05) |
| For anything that touches a store | A developer sets up the token and the store allow-list once (section 7). You do not need the token to validate or preview offline |

On Windows, run commands in Git Bash (or PowerShell with Node 22 first on the path). Quote paths that contain spaces.

## 2. Fill in the sheet

One **row per size**. The first row of each model holds the model-level cells (name, brand, description and so on). Other size rows may leave them blank; they inherit. If you fill them, they must match the first row exactly.

**Never change a handle after the product is in the store**: the handle is how a re-run finds the product.

| Column | Required? | Rule in short |
|---|---|---|
| `model` | yes | Product name shown to shoppers (at most 150 characters) |
| `brand` | yes | Must match a brand entry in Shopify (handle = brand name, lower case, hyphens) |
| `product_line` | no | Series within the brand |
| `handle` | yes | Lower-case letters, digits, hyphens; at most 100 |
| `product_type` | no | Blank means Mattress. For protectors, pillows, foundations type the product type; comfort, mattress type, positions, delivery type and images are then optional |
| `size` | yes | `Twin`, `Twin XL`, `Full`, `Queen`, `King`, `California King`, `Split California King` |
| `dimensions` | no (warning if blank) | For example `60 in x 80 in` |
| `sku` | yes | Unique across the whole sheet; letters, digits, `. - _ /`; at most 64 |
| `price` | yes | US dollars, for example `1299.00` |
| `sale_price` | no | Must be lower than `price`. In Shopify the sale price becomes the price and the regular price is crossed out. Empty the cell to end the sale |
| `comfort_level` | mattresses | `Ultra Plush`, `Plush`, `Medium`, `Firm`, `Extra Firm` |
| `mattress_type` | mattresses | `Memory Foam`, `Hybrid`, `Innerspring`, `Foam`, `Latex` |
| `sleep_positions` | mattresses | One or more of `Back`, `Side`, `Stomach` separated by `\|` |
| `benefits` | no | `Cooling`, `Pressure Relief`, `Motion Separation`, `Back Support`, `Eco-Friendly`, separated by `\|` |
| `height_inches` | no (warning if blank) | `12` or `12.5`; at most 60 |
| `delivery_type` | mattresses | `white-glove`, `parcel` or `both` |
| `description` | no | Plain text; a blank line starts a paragraph. **No HTML** |
| `overview_bullets` | no | Up to 12, separated by `\|`; each at most 200 characters (a warning above 8) |
| `specifications` | no | `Label=value` pairs separated by `\|`; up to 40 |
| `seo_title`, `seo_description` | no | At most 70 and 320 characters; about 60 and 160 is best |
| `images` | no | File names separated by `\|`, display order; the first is the main image; up to 20 |
| `extend_category` | no | Extend protection category, if known |
| `related_foundations`, `related_protectors`, `related_bedding` | no | Handles of matching add-on products, separated by `\|` (up to 12 each). The handles must exist in the sheet or the store |
| `compare_group` | no | Same value means "similar products" |
| `copy_approved` | no | `yes` once **you** approved the written text (SOW section 8; CLR-017). Only approved products are published; the rest are created as drafts |

Rules that catch people:

- Save as **CSV UTF-8 (Comma delimited)**. In Excel use "CSV UTF-8".
- A cell starting with `=`, `+`, `-` or `@` is refused (spreadsheets treat it as a formula). Rephrase.
- HTML in any cell is refused; control characters are refused.
- Allowed words for comfort, type, benefits and so on are the same words the quiz and filters use. Capitals do not matter (`plush` becomes `Plush`).
- Limits: the file at most 5 MB, at most 5,000 rows, **at most 400 models** (SOW section 8; the validator warns above 400), at most 7 sizes per model. More than 400 products is a change request (SOW section 13).
- Prices outside $50 to $20,000, a larger size cheaper than a smaller one, or a sale price below 30 percent of the regular price give **warnings**, not errors.

**Copy is yours to approve.** Drafted descriptions, bullets, SEO titles and meta descriptions use only facts you or the manufacturer supplied (SOW section 8). Set `copy_approved` to `yes` per product only after you approve it. An already-live product whose copy is later un-approved would go back to draft; the tool blocks that unless you pass `--allow-removals`.

## 3. Images

1. Put the files in one folder, named exactly as in the sheet. Name them by product; add `-queen`, `-king` and so on for a size-specific picture.
2. The first name in `images` is the main picture. The tool builds the picture description (alt text) from the product name, the size when the file name says so, and the picture number. It cannot know what the photo shows; review alt text for important products.
3. Missing file: error `E_MISSING_IMAGE`. A file in the folder that no row uses: warning `W_UNREFERENCED_IMAGE`. The same file for two products: warning `W_IMAGE_SHARED`. Empty or unreadable file: the product is `BLOCKED`.
4. Images upload only for products that need them, and only on a live run. Images that are in Shopify but not in the sheet are not removed unless `--allow-removals` is given.
5. For planning without the folder you can give a plain text file with one file name per line (`--images list.txt`). A live run needs the real folder.

You supply the images (manufacturer images, named by product). Photography is not part of the project (EXC-10).

## 4. Validate (no store, no password)

```
node scripts/catalog/validate.mjs path/to/products.csv --images path/to/images --report validation-report.md --json validation-report.json
```

- `PASSED` means no errors; exit code 0. `FAILED`: fix every error and run again; **the importer refuses to run while any error remains.**
- Row numbers match Excel and Google Sheets (the header is row 1).
- Codes starting `E_` must be fixed; codes starting `W_` are warnings. Add `--strict` to treat warnings as failures.

| Code (examples) | Plain meaning | Fix |
|---|---|---|
| `E_REQUIRED` | A required cell is empty | Fill it |
| `E_UNKNOWN_VALUE` | A word that is not allowed; the message lists the allowed words and the closest match | Use the listed word |
| `E_DUPLICATE_SKU`, `E_DUPLICATE_SIZE`, `E_DUPLICATE_MODEL` | Same SKU, same size twice, or a model split into non-adjacent groups | Make SKUs unique; keep a model's rows together |
| `E_INCONSISTENT_ATTRIBUTE` | A size row disagrees with the first row of its model | Blank it, or make it identical |
| `E_SALE_NOT_LOWER` | Sale price is not below price | Lower the sale price or empty it |
| `E_BAD_HANDLE`, `E_BAD_SKU`, `E_BAD_PRICE`, `E_BAD_NUMBER` | Format problem | Follow the rule in section 2 |
| `E_FORMULA`, `E_HTML`, `E_CONTROL_CHARS` | A cell starts with `= + - @`, holds HTML, or has hidden characters | Rewrite as plain text |
| `E_TOO_LONG`, `E_TOO_MANY_ITEMS` | Over a length or count limit | Shorten or split |
| `E_HEADER_MISSING`, `E_HEADER_DUPLICATE` | A column is missing or repeated; often the file was not saved as comma-separated | Re-save as "CSV UTF-8 (Comma delimited)" |
| `E_MISSING_IMAGE`, `E_BAD_IMAGE_NAME` | Image not in the folder, or a bad file name | Add the file or fix the name |
| `E_APPROVED_WITHOUT_COPY` | `copy_approved` is `yes` but a description is missing | Add the text or set it back to `no` |
| `W_UNAPPROVED_COPY`, `W_MISSING_COPY` | Text not yet approved or missing | Expected until you approve |
| `W_PRICE_UNUSUAL`, `W_PRICE_SIZE_ORDER`, `W_DEEP_DISCOUNT` | Probably unintended price | Check, then ignore if intended |

Try the tool on the samples first: `scripts/catalog/sample/mattresses.csv` passes; `scripts/catalog/sample/invalid.csv` fails with one example of every error (`invalid.expected.json` says which row shows which). **The brands and products in the samples are invented** (DEC-077).

## 5. Preview the plan (nothing is written)

Offline, no store, no password (assumes an empty store):

```
node scripts/catalog/import.mjs path/to/products.csv --offline --images path/to/images
```

Against a real store, reading only (a developer sets this up once, section 7):

```
node scripts/catalog/import.mjs path/to/products.csv --images path/to/images
```

| Plan action | Meaning |
|---|---|
| `CREATE` | The handle is not in the store |
| `UPDATE` | The handle exists and something differs; the changes are listed (for example `Queen price`) |
| `unchanged` | The store already matches. **A second run of the same sheet must show only `unchanged`** |
| `BLOCKED` | The tool refuses and says why |

`BLOCKED` reasons: Shopify has a size or an image that is not in the sheet (add it to the sheet, or use `--allow-removals` if the deletion is intended); a SKU already belongs to a different product; an image file is empty or unreadable; a live product would go back to draft because its copy is not approved.

The tool never removes your own tags or custom data that the sheet does not manage. A blank attribute, description or SEO cell never overwrites a value someone typed in Shopify admin; title, brand, product type, sizes, prices and status always follow the sheet.

## 6. Run it for real (not yet done anywhere)

A live run needs, in this order:

1. The **written go-ahead** for the target store (development store first; a live-store write needs explicit approval from the project owner and the client).
2. A **Shopify product export** taken first (Shopify admin > Products > Export) as your own restore point.
3. The one-time setup (section 7).
4. A dry run that shows the plan you expect.

Then, for one product first:

```
node scripts/catalog/import.mjs path/to/products.csv --images path/to/images --live --only one-handle
```

Check that product in Shopify admin (sizes, prices, sale price, images, description, tags, brand link). Then run the whole sheet by leaving off `--only`. To publish approved products to a sales channel add `--publication <publication id>` (needs `write_publications`).

- Each live run writes a **run record** to `scripts/catalog/.runs/` (excluded from git): what was created, what was updated **with the previous values**, what failed, what was skipped. **Keep it.**
- If a run stops half way, fix the cause and run again; finished products show as `unchanged`. One product failing does not stop the others; a credential or store error stops the run.
- There is **no automatic undo**. To restore a price or text, a person uses the "before" values in the run record. Created products have no previous state.
- Sequential, throttled calls: a 400-product run is slow (about three Shopify calls per product, within Shopify's Admin limit of 100 points a second). The real duration is `UNVERIFIED`.

Exit codes: `0` success. `1` the sheet has errors, products are blocked or something failed. `2` bad command line or unreadable file. `3` refused by the safety checks (store not on the allow-list, `--live` missing for a write, or no token).

## 7. One-time setup (developer)

Set these in the shell session, never in a file in the repository and never on the command line:

| Variable | Meaning |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | `your-store.myshopify.com` (or pass `--store`) |
| `SHOPIFY_ALLOWED_STORES` | Comma-separated stores this machine may touch. The tool **refuses any store not listed**, for dry runs as well as live runs |
| `SHOPIFY_ADMIN_API_ACCESS_TOKEN` | The Admin API token of the custom-distribution app. This is the **write-capable importer token**; it is not the `read_orders`-only token on the server. Never printed or logged |
| `SHOPIFY_ADMIN_API_VERSION` | Optional; defaults to `2026-10` |

Scopes expected (`UNVERIFIED`, V-20): `read_products`, `write_products`, `read_metaobjects`, `write_files`, `write_publications` only with `--publication`; definitions need `read_metaobject_definitions` and `write_metaobject_definitions`.

Before the first product import, the developer runs `node scripts/shopify/apply-definitions.mjs --store <store>` (dry run first; `--live` creates missing definitions) and creates the brand entries (RUNBOOKS 6.2). Never put these variables on the web server.

## 8. After an import: what the tool does not do

1. **Tags for service products.** Add `offer-only` to the haul-away service, gift products and variants, comfort-guarantee protectors and any product that exists only to be added by an offer; add `extend-coverage` to Extend protection price-point products. The website then keeps them out of the sitemap and marks them `noindex` ([ADMIN_GUIDE](ADMIN_GUIDE.md) section 2.8). Do **not** tag a protector that is also sold normally. `BUILT, AWAITING DEV-STORE VERIFICATION`.
2. **Filters.** Configure Search and Discovery filters for size, brand, comfort and type (manual; V-04).
3. **Collections.** Collections are rule-based on the tags the tool adds (`brand:`, `comfort:` and so on). Check them (P3A-08).
4. **Spot-check** products field by field (P3A-11) and allow the page cache delay ([ADMIN_GUIDE](ADMIN_GUIDE.md) section 10.2).
5. **Brands.** The brand link only resolves if a brand entry with the matching handle already exists.

## 9. Changing prices and sales later

Edit `price` and `sale_price` in the sheet, validate, preview, run live. Only changed products are touched. To end a sale, empty `sale_price`. Small changes (one price) can be made in Shopify admin directly ([ADMIN_GUIDE](ADMIN_GUIDE.md) section 2); **if you edit in admin and later re-run an old sheet, the sheet's prices win**, so keep the sheet current or choose one method per change (ADMIN_GUIDE 2.1).

## 10. Acceptance for the handover (REQ-HAND-002)

The client runs the tool from a clean checkout following this guide and records: validator result on the completed sheet, dry-run plan, live `--only` run on a development store, the full run, and a second run showing only `unchanged`. **None of these has happened.** Record the result in `progress/TEST_RESULTS.md` with date and tester.

## What this guide does not cover

Writing product copy (drafting from your facts is a separate step with an approval status per product, CLR-017); store pages, quiz, offers and delivery zone (ADMIN_GUIDE); the Extend protection catalog; importing customers, orders or reviews (SOW section 9); more than 400 products.
