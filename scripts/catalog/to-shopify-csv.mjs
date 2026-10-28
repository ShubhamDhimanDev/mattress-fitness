#!/usr/bin/env node
// Converts a VALIDATED product sheet (the project format, scripts/catalog/README.md) into the column layout of Shopify's own
// product export, so the same catalog can be loaded through Shopify admin (Products > Import) as well as through import.mjs.
//
//   node scripts/catalog/to-shopify-csv.mjs sheet.csv out.csv [--images-base https://example.com/images/]
//
// What it writes: one row per size; the product columns only on the first row of a model (Shopify's convention); Option1 is
// "Size"; Variant Price and Compare At Price follow the sheet's sale rules (a sale price becomes the price and the regular price
// the compare-at price); Status is `active` only for approved copy and `draft` otherwise, like the importer.
// What it does NOT write: custom metafields (comfort level, type, brand reference, specifications): Shopify's import cannot set
// metaobject references, so use import.mjs when the storefront filters and spec tables are needed.
// Images are written only with --images-base (a public folder URL the files are uploaded to); otherwise the Image columns are
// empty and Shopify shows no photo.
import { readFile, writeFile } from 'node:fs/promises';
import { stringifyCsv } from './csv.mjs';
import { descriptionToHtml, formatMoney } from './map.mjs';
import { validateSheet } from './validate.mjs';

/** The header of Shopify's product export (as attached by the owner, 2026-10-26), in order. */
export const SHOPIFY_COLUMNS = Object.freeze([
  'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type', 'Tags', 'Published',
  'Option1 Name', 'Option1 Value', 'Option1 Linked To', 'Option2 Name', 'Option2 Value', 'Option2 Linked To', 'Option3 Name', 'Option3 Value', 'Option3 Linked To',
  'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Qty', 'Variant Inventory Policy', 'Variant Fulfillment Service',
  'Variant Price', 'Variant Compare At Price', 'Variant Requires Shipping', 'Variant Taxable',
  'Unit Price Total Measure', 'Unit Price Total Measure Unit', 'Unit Price Base Measure', 'Unit Price Base Measure Unit', 'Variant Barcodes',
  'Image Src', 'Image Position', 'Image Alt Text', 'Gift Card', 'SEO Title', 'SEO Description', 'Variant Image', 'Variant Weight Unit',
  'Variant Tax Code', 'Cost per item', 'Status',
  'Variant Packed Length', 'Variant Packed Width', 'Variant Packed Height', 'Variant Packed Dimension Unit',
]);

/** Shopify's standard product category taxonomy path for a mattress (the same text the owner's export carries). */
const MATTRESS_CATEGORY = 'Furniture > Beds & Accessories > Mattresses';

/**
 * @param {import('./validate.mjs').Product[]} products
 * @param {{ imagesBase?: string | null }} [options]
 * @returns {string[][]} header row first
 */
export function toShopifyRows(products, { imagesBase = null } = {}) {
  /** @type {string[][]} */
  const rows = [[...SHOPIFY_COLUMNS]];
  const col = (/** @type {string} */ name) => SHOPIFY_COLUMNS.indexOf(name);
  for (const product of products) {
    const isMattress = product.productType === 'Mattress' || product.productType === '';
    product.variants.forEach((variant, index) => {
      const row = SHOPIFY_COLUMNS.map(() => '');
      const set = (/** @type {string} */ name, /** @type {string} */ value) => { row[col(name)] = value; };
      set('Handle', product.handle);
      if (index === 0) {
        set('Title', product.model);
        set('Body (HTML)', descriptionToHtml(product.description ?? ''));
        set('Vendor', product.brand);
        if (isMattress) set('Product Category', MATTRESS_CATEGORY);
        set('Type', product.productType || 'Mattress');
        set('Tags', [product.brand && `brand:${product.brand}`, product.comfortLevel && `comfort:${product.comfortLevel}`, product.mattressType && `type:${product.mattressType}`, product.productLine && `line:${product.productLine}`].filter(Boolean).join(', '));
        set('Published', product.copyApproved ? 'true' : 'false');
        set('SEO Title', product.seoTitle ?? '');
        set('SEO Description', product.seoDescription ?? '');
        set('Status', product.copyApproved ? 'active' : 'draft');
      }
      set('Option1 Name', 'Size');
      set('Option1 Value', variant.size);
      set('Variant SKU', variant.sku);
      set('Variant Inventory Tracker', 'shopify');
      set('Variant Inventory Qty', '0');
      set('Variant Inventory Policy', 'deny');
      set('Variant Fulfillment Service', 'manual');
      set('Variant Price', formatMoney(variant.salePriceCents ?? variant.priceCents));
      set('Variant Compare At Price', variant.salePriceCents === null ? '' : formatMoney(variant.priceCents));
      set('Variant Requires Shipping', 'true');
      set('Variant Taxable', 'true');
      set('Gift Card', 'false');
      if (imagesBase && index < product.images.length) {
        set('Image Src', `${imagesBase.replace(/\/?$/, '/')}${product.images[index]}`);
        set('Image Position', String(index + 1));
        set('Image Alt Text', `${product.model}`);
      }
      rows.push(row);
    });
    // Models with more images than sizes get their extra image rows (Shopify reads an image-only row as one more image).
    if (imagesBase) {
      for (let index = product.variants.length; index < product.images.length; index += 1) {
        const row = SHOPIFY_COLUMNS.map(() => '');
        row[col('Handle')] = product.handle;
        row[col('Image Src')] = `${imagesBase.replace(/\/?$/, '/')}${product.images[index]}`;
        row[col('Image Position')] = String(index + 1);
        row[col('Image Alt Text')] = product.model;
        rows.push(row);
      }
    }
  }
  return rows;
}

/** @param {readonly string[]} argv */
export async function main(argv) {
  const positional = argv.filter((arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--images-base');
  const baseIndex = argv.indexOf('--images-base');
  const imagesBase = baseIndex >= 0 ? argv[baseIndex + 1] ?? null : null;
  if (positional.length !== 2) {
    console.error('Usage: node scripts/catalog/to-shopify-csv.mjs <sheet.csv> <out.csv> [--images-base <public folder url>]');
    return 2;
  }
  const report = validateSheet(await readFile(positional[0], 'utf8'));
  if (!report.ok) {
    console.error(`The sheet has ${report.summary.errors} error(s); run validate.mjs and fix them first. Nothing was written.`);
    return 1;
  }
  const rows = toShopifyRows(report.products, { imagesBase });
  await writeFile(positional[1], stringifyCsv(rows, { eol: '\r\n' }), 'utf8');
  console.log(`Wrote ${rows.length - 1} rows for ${report.summary.models} products to ${positional[1]}.`);
  return 0;
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file:///').href || process.argv[1]?.endsWith('to-shopify-csv.mjs')) {
  process.exitCode = await main(process.argv.slice(2));
}
