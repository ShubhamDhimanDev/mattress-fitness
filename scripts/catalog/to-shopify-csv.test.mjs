import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateSheet } from './validate.mjs';
import { SHOPIFY_COLUMNS, toShopifyRows } from './to-shopify-csv.mjs';

const SAMPLE = new URL('./sample/offer-products.csv', import.meta.url);
const sample = async () => {
  const report = validateSheet(await readFile(SAMPLE, 'utf8'));
  assert.equal(report.ok, true);
  return report.products;
};

test('the header is the 47 columns of Shopify\'s own product export, in order', () => {
  assert.equal(SHOPIFY_COLUMNS.length, 47);
  assert.deepEqual(SHOPIFY_COLUMNS.slice(0, 8), ['Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type', 'Tags', 'Published']);
  assert.equal(SHOPIFY_COLUMNS.at(-1), 'Variant Packed Dimension Unit');
});

test('one row per size, product columns only on the first row of a model, Option1 is Size', async () => {
  const products = await sample();
  const rows = toShopifyRows(products);
  const [header, ...body] = rows;
  assert.equal(body.length, products.reduce((sum, product) => sum + product.variants.length, 0));
  const at = (name) => header.indexOf(name);
  const first = body.find((row) => row[at('Handle')] === 'luxe-hybrid');
  const second = body.filter((row) => row[at('Handle')] === 'luxe-hybrid')[1];
  assert.equal(first[at('Title')], 'Halden Luxe Hybrid');
  assert.equal(second[at('Title')], '');
  assert.equal(first[at('Option1 Name')], 'Size');
  assert.equal(second[at('Option1 Name')], 'Size');
  assert.notEqual(first[at('Option1 Value')], second[at('Option1 Value')]);
});

test('a sale price becomes the price and the regular price the compare-at price; status follows copy approval', async () => {
  const [header, ...body] = toShopifyRows(await sample());
  const at = (name) => header.indexOf(name);
  const queen = body.find((row) => row[at('Variant SKU')] === 'HLH01-Q');
  assert.equal(queen[at('Variant Price')], '1799.00');
  assert.equal(queen[at('Variant Compare At Price')], '1899.00');
  assert.equal(queen[at('Status')], 'active');
});

test('image columns are written only with a base URL; unapproved copy is a draft', async () => {
  const csv = (await readFile(new URL('./brand-catalog/brand-mattresses.csv', import.meta.url), 'utf8'));
  const report = validateSheet(csv);
  assert.equal(report.ok, true);
  const without = toShopifyRows(report.products);
  const at = (name) => without[0].indexOf(name);
  assert.ok(without.slice(1).every((row) => row[at('Image Src')] === ''));
  assert.equal(without[1][at('Status')], 'draft');
  assert.equal(without[1][at('Published')], 'false');
  const withImages = toShopifyRows(report.products, { imagesBase: 'https://example.com/img' });
  assert.equal(withImages[1][at('Image Src')], 'https://example.com/img/puffy-1.jpg');
});
