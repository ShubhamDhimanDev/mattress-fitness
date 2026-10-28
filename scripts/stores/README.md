# Store sheet and import tool

This folder holds the store sheet template, the checker that validates it, and the tool that loads it into Shopify as `store` entries (REQ-LOC-001, REQ-LOC-002, backlog P3A-07 and P3B-16, CLR-015). You edit a spreadsheet; the tools do the rest. Nothing is written to the store unless you ask for it explicitly.

Status (2026-10-28): built and unit-tested on a simulated Shopify only (`node --test "scripts/stores/*.test.mjs"`). It has **not** been run against any store, real or development. Before a first real run it needs the `store` definition applied (`scripts/shopify/apply-definitions.mjs`) and an Admin API token with `read_metaobjects` and `write_metaobjects`. The two Admin calls it makes (list `store` entries, `metaobjectUpsert`) follow the same pattern as `scripts/setup/seed-entries.mjs` but are unconfirmed on a store (V-05).

## What you need

- Node.js 22 (`node --version`). Nothing else to install.
- The template `scripts/stores/template/stores.csv` (open it in Excel or Google Sheets, save as CSV UTF-8).
- For anything beyond `--check` and `--offline`: the store domain, the Admin token and an allow-list, supplied through the environment.

## 1. Fill in the sheet

One **row per store**. Delete the template's example row (it is refused on purpose: its slug starts with `example-`).

| Column                  | Required | What to enter                                                                                                                                                                                                  |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`                  | yes      | Lowercase letters, digits and single hyphens, up to 80 (for example `chicago-loop`). It is the store page address **and** the entry handle a re-run uses to find the entry: do not change it once imported.   |
| `name`                  | yes      | Store name shown to shoppers (up to 120 characters, plain text).                                                                                                                                               |
| `address_line_1`        | yes      | Street address (up to 120).                                                                                                                                                                                    |
| `address_line_2`        | no       | Suite or unit.                                                                                                                                                                                                 |
| `city`                  | yes      | Up to 80 characters.                                                                                                                                                                                           |
| `state`                 | yes      | US state or DC: `IL` or `Illinois`. Territories are not accepted (the website does not either).                                                                                                                |
| `postal_code`           | yes      | Exactly 5 digits. Format the column as **text**, or a spreadsheet drops a leading 0 (the checker tells you when it sees a 4-digit ZIP). ZIP+4 is refused.                                                     |
| `latitude`, `longitude` | no       | Decimal degrees; give both or neither. Without them the map uses the address. `0, 0` is refused.                                                                                                               |
| `phone`                 | no       | US number with 10 digits, for example `(212) 555-0100`. No extensions or letters. Stored as `(212) 555-0100`.                                                                                                  |
| `hours`                 | no       | Weekly hours, see below.                                                                                                                                                                                       |
| `time_zone`             | no       | IANA name such as `America/New_York`, `America/Chicago`, `America/Denver`, `America/Los_Angeles`. Not `EST` or `Central`. Without it the hours are listed but the site cannot say "Open now".                  |
| `pickup_enabled`        | no       | `true` or `false` (`yes`, `no`, `1`, `0` also work).                                                                                                                                                           |
| `location_handle`       | no       | The matching Shopify location, written with hyphens instead of spaces (`buffalo-gallery`), or its numeric id.                                                                                                  |

Not in the sheet: the store **photo**. A file reference cannot come from a cell; attach it in Shopify admin (ADMIN_GUIDE 5.1). The importer never touches the photo.

### Hours

Write one entry per day group, separated by `;` or a new line: `Mon-Fri 10:00 AM - 9:00 PM; Sat 10am-6pm; Sun Closed`. Understood: day ranges (`Mon-Fri`, `Fri-Mon`), lists (`Sat, Sun`), `weekdays`, `weekends`, `daily`; times as `10am`, `10:00 AM`, `10:00`, `noon`, `midnight`; `Closed`; `Open 24 hours`; up to three intervals a day (`9am-12pm, 1pm-5pm`); overnight hours (`6pm-2am`, up to 16 hours). Days you do not mention are shown as closed (the checker leaves a note). A bare `9-5` is refused as ambiguous. The checker applies the same rules as the website's own reader (`storefront/app/lib/stores/hours.ts`; a port in `hours.mjs`), and refuses anything the website would drop: a day given twice, overlapping times, unreadable times.

What is stored: the **Opening hours** field is a JSON field, so the importer writes the typed text as the JSON object the site reads, for example `{"Mon-Fri":"10:00 AM - 9:00 PM","Sat":"10am-6pm","Sun":"Closed"}`. A cell that already is JSON in one of the site's accepted shapes is kept as given (compacted).

## 2. Check the sheet (no store, no token, no network)

```
node scripts/stores/import.mjs my-stores.csv --check
```

Every problem is listed with its spreadsheet row (header = row 1) and column, all at once. Notes (no coordinates, no phone, hours without a time zone, pickup without a location) do not block the import. Exit code 0 means the sheet is ready.

## 3. Dry run, then import

```
# plan against an empty store, no network, no credentials
node scripts/stores/import.mjs my-stores.csv --offline

# dry run: reads the store, writes nothing (default)
bash scripts/setup/with-admin-token.sh node scripts/stores/import.mjs my-stores.csv

# write (first time: try one store with --only)
bash scripts/setup/with-admin-token.sh node scripts/stores/import.mjs my-stores.csv --live --only chicago-loop
bash scripts/setup/with-admin-token.sh node scripts/stores/import.mjs my-stores.csv --live
```

Options: `--store <name>.myshopify.com` (default `$SHOPIFY_STORE_DOMAIN`, then `$STORE`, which `with-admin-token.sh` exports), `--only <slug1,slug2>`, `--check`, `--offline`, `--live`. Exit codes: 0 ok, 1 sheet errors, failed writes or blocked stores, 2 usage or file problem, 3 refused by a guard.

Tests: `node --test "scripts/stores/*.test.mjs"` from the repository root (Node 22 treats a bare directory argument as a file, so use the glob).

Safety, the same as the product importer (T-14):

- Dry run is the default; the Admin client is created without mutation permission unless `--live` is given.
- Any contact with a store, even read-only, needs the store in `SHOPIFY_ALLOWED_STORES`; a custom domain is refused.
- The token is read from `SHOPIFY_ADMIN_API_ACCESS_TOKEN` only, goes only into the request header of the allow-listed `*.myshopify.com` host, and is never printed (output is run through the redaction layer).
- A sheet with any error imports nothing.
- Nothing is deleted. Entries that are in Shopify but not in the sheet are listed and left alone.
- A blank cell is never sent, so it **cannot erase** a value someone typed in Shopify admin; the dry run lists such fields ("left as it is"). To clear a field, clear it in admin.
- Idempotent: a re-run compares each entry with the sheet and sends only the fields that differ, so a second run with the same sheet is an empty plan. One failed store does not stop the others; run the same command again and only the failed ones are retried.
- If another entry already has the same slug under a different handle, that store is **blocked** (two stores would share one web address).

## Honest limits

- Not run against any store. The first real run is a checklist item (development store first, `--only` one slug, check the entry in admin and the store page on the site).
- Entry status: the upsert does not set a publishing status, like `seed-entries.mjs`. If the `store` definition has the publishable capability switched on in the store, new entries must be set to Active in admin before the website sees them. Not confirmed.
- Whether `metaobjectUpsert` with only some fields leaves the others untouched is the behaviour the seed script relies on, but it is unconfirmed on a store. The importer only depends on it for the blank-cell rule above.
- The hours check is a port of the website reader, kept in step by hand (`hours.mjs`, `hours.test.mjs`). The time-zone check is stricter than the website on purpose (IANA `Area/Location` names only).
- The `location_handle` rule follows the website's reader (letters, digits, `-`, `_`, no spaces). ADMIN_GUIDE 5.2 says a name with spaces such as "Buffalo Gallery" is matched; the reader (`parse.ts`) would drop it, so the sheet requires the hyphenated form.
- No run manifest file is written (the product importer writes one); the console output lists field names written per store, never values.
- Up to 250 stores per sheet, 1 MB per file.
