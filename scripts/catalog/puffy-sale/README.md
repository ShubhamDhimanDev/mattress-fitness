# Puffy mattress sale prices (2026-11-12)

Owner request: check Puffy's own website and put Puffy's sale prices on the Puffy mattresses.

- **Source.** `puffy.com/products/<handle>` publishes, per size, the price a shopper pays today (JSON-LD offers, "Early Black Friday Sale: save $1,350+", valid until **2026-11-22**). The regular price per size comes from the same site's public `/products.json` feed. Only the five mattress models (Cloud, Lux, Royal, Monarch, Legacy) have a sale; the frames, bases, bedding and accessories show their regular price only.
- **What it does.** `apply.mjs` sets each Puffy mattress variant's price to the sale price and its compare-at price to the regular price (Twin to California King; the Split sizes of the site are not on our store). 26 variants were changed on 2026-11-12 on `mattressfitness-1iakxuvz`. The saving is $1,350 on most sizes, from $900 (Legacy Twin XL) to $1,450 (Monarch Twin XL).
- **Safe by construction.** A variant is changed only when its current regular price equals the regular price Puffy lists; a price changed by hand is reported and left alone. A second run changes nothing.
- **Not copied.** Puffy's free bundle ("2 Signature Pillows + Signature Sleep Mask, worth $315") and the code `BLACKFRIDAY`: a gift needs its own discount in Shopify admin (ADR-0003), which has not been made.
- **The sale ends 2026-11-22 on their site; this store does not end it by itself.** Then run `apply.mjs --live --end` (price back to the regular price, compare-at cleared), or run `build.mjs` again against fresh pages and `apply.mjs --live` for the next sale.

```
node scripts/catalog/puffy-sale/build.mjs                                                   # raw read + feed -> puffy-sale-prices.json
bash scripts/setup/with-admin-token.sh node scripts/catalog/puffy-sale/apply.mjs            # dry run
bash scripts/setup/with-admin-token.sh node scripts/catalog/puffy-sale/apply.mjs --live
```

The raw read is a browser read of the public product pages (git-ignored under `brand-catalog/.scrape/`); their robots.txt allows it, and the 23 page reads were paced three seconds apart.
