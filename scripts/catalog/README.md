# Product sheet and import tool

This folder holds the product sheet template, the checker that validates it, and the tool that loads it into Shopify (REQ-CAT-001, REQ-CAT-002, REQ-CAT-003, REQ-CAT-009). You edit a spreadsheet; the tools do the rest. Nothing is written to the store unless you ask for it explicitly.

Status (checked 2026-10-15): built and tested against a simulated Shopify (`node --test "scripts/**/*.test.mjs"`; 238 passing on the orchestrator's last record). It has **not** yet been run against a real store, because no development store exists yet. The first real run is a checklist item in the Phase 3A plan. Two things the website does with the result that you should know: it treats products tagged `offer-only` or `extend-coverage` as service products and keeps them out of the sitemap (the importer does not add those tags; add them in Shopify admin, see the admin guide section 2.8), and the `related_*` handle lists are stored on the product but the cart's add-on offers are not read from them yet.

## What you need

- Node.js 22 (check with `node --version`). Nothing else to install: the tools use only what Node includes.
- The template `scripts/catalog/template/products.csv` (open it in Excel or Google Sheets).
- The image files, named exactly as written in the sheet, in one folder.

## 1. Fill in the sheet

One **row per size**. All the sizes of one model share a **handle**, which is the web address slug (for example `cloud-hybrid` becomes `/products/cloud-hybrid`). The handle is also how a re-run knows which product to update, so **do not change a handle once the product is in the store**.

Fill the model-level cells (brand, comfort level, description, images and so on) on the **first row of the model**. On the other size rows leave them blank; they inherit from the first row. If you do fill them, they must be identical.

| Column                                                         | What to enter                                                                                                                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`                                                        | Product name shown to shoppers                                                                                                                                               |
| `brand`                                                        | Brand name (must match a brand entry in Shopify to show brand sections)                                                                                                      |
| `product_line`                                                 | Series or collection within the brand                                                                                                                                        |
| `handle`                                                       | Lowercase letters, digits and hyphens only                                                                                                                                   |
| `product_type`                                                 | Leave blank for mattresses. For other items (protectors, pillows) type the product type; comfort, mattress type, sleep positions, delivery type and images are then optional |
| `size`                                                         | `Twin`, `Twin XL`, `Full`, `Queen`, `King`, `California King` or `Split California King`                                                                                     |
| `dimensions`                                                   | For example `60 in x 80 in`                                                                                                                                                  |
| `sku`                                                          | Unique per row. Letters, digits, `.` `-` `_` `/`                                                                                                                             |
| `price`                                                        | Regular price in US dollars, for example `1299.00`                                                                                                                           |
| `sale_price`                                                   | Optional. Must be **lower** than the price. In Shopify the sale price becomes the price and the regular price is shown crossed out. Empty the cell to end the sale           |
| `comfort_level`                                                | `Ultra Plush`, `Plush`, `Medium`, `Firm`, `Extra Firm`                                                                                                                       |
| `mattress_type`                                                | `Memory Foam`, `Hybrid`, `Innerspring`, `Foam`, `Latex`                                                                                                                      |
| `sleep_positions`                                              | One or more of `Back`, `Side`, `Stomach`, separated by `\|`                                                                                                                  |
| `benefits`                                                     | Zero or more of `Cooling`, `Pressure Relief`, `Motion Separation`, `Back Support`, `Eco-Friendly`, separated by `\|`                                                         |
| `height_inches`                                                | For example `12` or `12.5`                                                                                                                                                   |
| `delivery_type`                                                | `white-glove`, `parcel` or `both`                                                                                                                                            |
| `description`                                                  | Plain text. A blank line starts a new paragraph. **No HTML**                                                                                                                 |
| `overview_bullets`                                             | Feature bullets separated by `\|` (up to 12)                                                                                                                                 |
| `specifications`                                               | `Label=value` pairs separated by `\|`, for example `Thickness=12 in\|Cover=Quilted knit`                                                                                     |
| `seo_title`, `seo_description`                                 | Search result text. About 60 and 160 characters is best                                                                                                                      |
| `images`                                                       | File names separated by `\|`, in display order. The first is the main image                                                                                                  |
| `extend_category`                                              | Extend protection category, if known                                                                                                                                         |
| `related_foundations`, `related_protectors`, `related_bedding` | Handles of matching add-on products, separated by `\|`                                                                                                                       |
| `compare_group`                                                | Products with the same value are offered as similar products                                                                                                                 |
| `copy_approved`                                                | `yes` once the client has approved the written text. **Only approved products are published**; the others are created as drafts                                              |

Rules of thumb: the allowed words are listed in `scripts/catalog/schema.mjs` and are the same words the quiz and the filters use. Capital letters do not matter (`plush` is read as `Plush`). Save as **CSV UTF-8 (Comma delimited)**. Cells that start with `=`, `+`, `-` or `@` are refused because spreadsheets treat them as formulas; rephrase them.

## 2. Validate the sheet

```
node scripts/catalog/validate.mjs path/to/products.csv --images path/to/images --report validation-report.md --json validation-report.json
```

`--images` is optional but recommended: it checks that every image named in the sheet exists in the folder. A plain text file with one file name per line also works there.

How to read the result:

- **PASSED** means there are no errors. The tool exits with code 0.
- **FAILED** means there is at least one error. Fix every error and run again. **The import tool refuses to run while any error remains.** Exit code 1.
- **Row** is the row number you see in Excel or Google Sheets (the header is row 1).
- **Errors** (codes starting `E_`) must be fixed. Examples: a missing SKU, a duplicate SKU, an unknown comfort level (the message lists the allowed words and suggests the closest), a sale price that is not lower than the price, an image that is not in the folder, a size row that disagrees with the first row of its model.
- **Warnings** (codes starting `W_`) do not block anything. They flag things that are probably unintended (a price far outside the usual range, a larger size cheaper than a smaller one, an unusually deep discount) or work still to do (copy not yet approved, a missing height). Read them anyway.
- Add `--strict` to treat warnings as failures.

Try it on the examples first: `scripts/catalog/sample/mattresses.csv` passes, `scripts/catalog/sample/invalid.csv` fails with one example of every kind of error (`invalid.expected.json` says which row shows which error). The brands and products in the samples are made up.

## 3. Preview the plan (nothing is written)

Offline, no store and no password needed. It assumes an empty store:

```
node scripts/catalog/import.mjs path/to/products.csv --offline --images path/to/images
```

Against a real store, reading only (a developer sets this up once, see section 5):

```
node scripts/catalog/import.mjs path/to/products.csv --images path/to/images
```

The plan lists each product as one of:

| Action      | Meaning                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `CREATE`    | The handle is not in the store yet                                                                        |
| `UPDATE`    | The handle exists and something differs. The changes are listed (for example `Queen price`)               |
| `unchanged` | The store already matches the sheet. **A second run of the same sheet must show nothing but `unchanged`** |
| `BLOCKED`   | The tool refuses to touch it and tells you why (see below)                                                |

`BLOCKED` reasons you may meet: Shopify has a size or an image that is **not in the sheet** (an update would delete it; add it to the sheet, or run with `--allow-removals` if the deletion is intended); a SKU already belongs to a different product; an image file is empty or unreadable.

The tool never deletes products, and it never removes the client's own tags or any custom data that the sheet does not manage.

## 4. Run it for real (later, with approval)

A live run needs, in this order: the written go-ahead for the target store, a Shopify product export taken first, and the setup in section 5. Then:

```
node scripts/catalog/import.mjs path/to/products.csv --images path/to/images --live --only one-handle
```

Start with a single product (`--only`), check it in Shopify admin, then run the whole sheet. Images are uploaded only for products that need them. To publish approved products to a sales channel add `--publication <publication id>`.

Each live run writes a **run manifest** (default folder `scripts/catalog/.runs/`, which the repository's `.gitignore` excludes; change it with `--manifest-dir`) listing what was created, what was updated (with the values before the change), what failed and what was skipped. Keep it. If a run stops half way, fix the cause and run again: finished products show as `unchanged`.

There is no automatic undo yet. The manifest holds what a revert needs (ids and previous values); building and approving a revert tool is a separate task, because deleting products in bulk needs explicit approval.

Updating prices later: edit `price` and `sale_price` in the sheet, validate, preview, run. Only the changed products are touched.

## 5. One-time setup for a live or read-only store run (developer)

Set these in the shell, never in a file in the repository and never on the command line:

| Variable                         | Meaning                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `SHOPIFY_STORE_DOMAIN`           | `your-store.myshopify.com` (or pass `--store`)                                                                                               |
| `SHOPIFY_ALLOWED_STORES`         | Comma separated list of the stores this machine may touch. The tool **refuses** any store not on the list, for dry runs as well as live runs |
| `SHOPIFY_ADMIN_API_ACCESS_TOKEN` | Admin API token of the custom-distribution app. Least privilege; never printed or logged                                                     |
| `SHOPIFY_ADMIN_API_VERSION`      | Optional; defaults to `2026-10`                                                                                                              |

PowerShell: `$env:SHOPIFY_ALLOWED_STORES = "your-store.myshopify.com"`. Git Bash: `export SHOPIFY_ALLOWED_STORES=your-store.myshopify.com`.

Scopes the token is expected to need (UNVERIFIED(V-20), confirm when the app is created): `read_products`, `write_products`, `read_metaobjects`, `write_files` (images), and `write_publications` only if you use `--publication`. Staged uploads, metafield and metaobject definitions need `read_metaobject_definitions` and `write_metaobject_definitions` (see `scripts/shopify/README.md`).

Safety built in: dry run is the default; `--live` is required to write; the store must be on the allow list; the sheet is validated first and nothing is sent if it has errors; sheet text is treated as untrusted (formulas and HTML are refused, and descriptions are escaped before they reach Shopify); the token is removed from every message.

## Exit codes

`0` success. `1` the sheet has errors, products are blocked or something failed. `2` bad command line or unreadable file. `3` refused by the safety checks (store not allowed, missing `--live` for a write, no token).

## How the sheet maps to Shopify

- One product per model, one variant per size, with a `Size` option. Sizes are always created in the order Twin, Twin XL, Full, Queen, King, California King, Split California King.
- Sale price becomes the variant price and the regular price becomes the compare-at price.
- Attributes are saved as product metafields (`custom.comfort_level`, `custom.mattress_type`, `custom.sleep_positions`, `custom.benefits`, `custom.product_line`, `custom.height_inches`, `custom.delivery_type`, `custom.specifications`, `custom.features`, `custom.compare_group`, `custom.extend_category`, and the related-product lists); dimensions are saved on each variant. A blank attribute, description or SEO cell never overwrites a value someone typed in Shopify admin (title, brand, product type, sizes, prices and status always follow the sheet).
- The brand is linked to the Shopify brand entry whose handle is the brand name in lowercase with hyphens (`Example Brand` becomes `example-brand`). Create the brand entries first.
- Image alt text is built from the product name, the size where the file name says so (`-queen`, `-king`, ...), and the picture number.
- Tags such as `brand:` and `comfort:` are added for collection rules; tags added by hand are kept.

Developers: the pieces are `schema.mjs` (columns and allowed values), `csv.mjs`, `sanitize.mjs`, `validate.mjs`, `map.mjs`, `reconcile.mjs` (what differs), `remote.mjs` (Shopify calls), `images.mjs`, `import.mjs`. Run all tests from the repository root with `node --test "scripts/**/*.test.mjs"`. (On Node 22 the quoted pattern is needed; `node --test scripts/` does not work.)
