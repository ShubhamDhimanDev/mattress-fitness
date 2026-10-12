import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_ALT_LENGTH, buildAltText, buildProductMetafields, buildTags, descriptionToHtml, detectSizeInFilename, formatMoney, mergeTags, metafieldValuesEqual, slugify, toDesiredProduct } from './map.mjs';
import { validateSheet } from './validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @returns {import('./validate.mjs').Product} */
function product(over = {}) {
  return {
    handle: 'cloud-hybrid', model: 'Cloud Hybrid', brand: 'Quillmoor Sleep', productLine: 'Cloud Series', productType: 'Mattress', description: 'Soft.\n\nSupportive.', bullets: ['Cooling cover', 'Zoned support'],
    specifications: [{ label: 'Firmness', value: 'Medium' }], seoTitle: 'Cloud Hybrid Mattress', seoDescription: 'A hybrid.', comfortLevel: 'Medium', mattressType: 'Hybrid', sleepPositions: ['Back', 'Side'],
    benefits: ['Cooling'], heightInches: '12', deliveryType: 'white-glove', images: ['cloud-hybrid-1.jpg', 'cloud-hybrid-king.jpg'], extendCategory: 'mattress', relatedFoundations: [], relatedProtectors: [],
    relatedBedding: [], compareGroup: 'cloud', copyApproved: true, firstRow: 2,
    variants: [
      { size: 'Queen', dimensions: '60 in x 80 in', sku: 'CH-Q', priceCents: 129900, salePriceCents: 109900, row: 2 },
      { size: 'King', dimensions: null, sku: 'CH-K', priceCents: 159900, salePriceCents: null, row: 3 },
    ],
    ...over,
  };
}
const context = { brandMetaobjectId: null, relatedProductIds: { relatedFoundations: [], relatedProtectors: [], relatedBedding: [] } };

test('formatMoney turns integer cents into a decimal string without float arithmetic', () => {
  assert.equal(formatMoney(129900), '1299.00');
  assert.equal(formatMoney(5), '0.05');
  assert.equal(formatMoney(100), '1.00');
  assert.equal(formatMoney(999999999), '9999999.99');
});

test('slugify makes URL-safe slugs and handles accents and ampersands', () => {
  assert.equal(slugify('Quillmoor Sleep'), 'quillmoor-sleep');
  assert.equal(slugify('Oakhollow Mattress Co.'), 'oakhollow-mattress-co');
  assert.equal(slugify('Crème & Café'), 'creme-and-cafe');
  assert.equal(slugify('  --Weird__Name!! '), 'weird-name');
});

test('sale price becomes the price and the regular price becomes compare-at; no sale means no compare-at', () => {
  const desired = toDesiredProduct(product(), context);
  assert.deepEqual(desired.variants.map((variant) => [variant.size, variant.price, variant.compareAtPrice]), [['Queen', '1099.00', '1299.00'], ['King', '1599.00', null]]);
  assert.ok(desired.variants.every((variant) => variant.compareAtPrice === null || Number(variant.compareAtPrice) > Number(variant.price)));
});

test('only approved copy is active; everything else is a draft (REQ-CAT-004)', () => {
  assert.equal(toDesiredProduct(product({ copyApproved: true }), context).status, 'ACTIVE');
  assert.equal(toDesiredProduct(product({ copyApproved: false }), context).status, 'DRAFT');
});

test('title, vendor, type, SEO and sizes come straight from the sheet', () => {
  const desired = toDesiredProduct(product(), context);
  assert.equal(desired.title, 'Cloud Hybrid');
  assert.equal(desired.vendor, 'Quillmoor Sleep');
  assert.equal(desired.productType, 'Mattress');
  assert.equal(desired.seoTitle, 'Cloud Hybrid Mattress');
  assert.equal(desired.seoDescription, 'A hybrid.');
  assert.deepEqual(desired.sizes, ['Queen', 'King']);
});

test('attributes become custom.* metafields with the right types; list and JSON values are JSON strings', () => {
  const byKey = Object.fromEntries(toDesiredProduct(product(), context).metafields.map((metafield) => [metafield.key, metafield]));
  assert.ok(Object.values(byKey).every((metafield) => metafield.namespace === 'custom'));
  assert.deepEqual(byKey.comfort_level, { namespace: 'custom', key: 'comfort_level', type: 'single_line_text_field', value: 'Medium' });
  assert.equal(byKey.mattress_type.value, 'Hybrid');
  assert.deepEqual([byKey.sleep_positions.type, byKey.sleep_positions.value], ['list.single_line_text_field', '["Back","Side"]']);
  assert.deepEqual([byKey.benefits.type, byKey.benefits.value], ['list.single_line_text_field', '["Cooling"]']);
  assert.deepEqual([byKey.features.type, byKey.features.value], ['list.single_line_text_field', '["Cooling cover","Zoned support"]']);
  assert.deepEqual([byKey.specifications.type, byKey.specifications.value], ['json', '[{"label":"Firmness","value":"Medium"}]']);
  assert.deepEqual([byKey.height_inches.type, byKey.height_inches.value], ['number_decimal', '12']);
  assert.equal(byKey.delivery_type.value, 'white-glove');
  assert.equal(byKey.extend_category.value, 'mattress');
  assert.equal(byKey.compare_group.value, 'cloud');
  assert.equal(byKey.product_line.value, 'Cloud Series');
});

test('blank sheet cells produce no metafield, so an import never overwrites admin edits with nothing', () => {
  const sparse = product({ productLine: null, heightInches: null, benefits: [], bullets: [], specifications: [], extendCategory: null, compareGroup: null, deliveryType: null });
  const keys = buildProductMetafields(sparse, context).map((metafield) => metafield.key).sort();
  assert.deepEqual(keys, ['comfort_level', 'mattress_type', 'sleep_positions']);
});

test('the brand and related-product references are written only when they resolve to Shopify ids', () => {
  const none = buildProductMetafields(product(), context).map((metafield) => metafield.key);
  assert.ok(!none.includes('brand') && !none.includes('related_foundations'));
  const linked = buildProductMetafields(product(), {
    brandMetaobjectId: 'gid://shopify/Metaobject/1',
    relatedProductIds: { relatedFoundations: ['gid://shopify/Product/9'], relatedProtectors: [], relatedBedding: ['gid://shopify/Product/7', 'gid://shopify/Product/8'] },
  });
  const byKey = Object.fromEntries(linked.map((metafield) => [metafield.key, metafield]));
  assert.deepEqual([byKey.brand.type, byKey.brand.value], ['metaobject_reference', 'gid://shopify/Metaobject/1']);
  assert.deepEqual([byKey.related_foundations.type, byKey.related_foundations.value], ['list.product_reference', '["gid://shopify/Product/9"]']);
  assert.equal(byKey.related_bedding.value, '["gid://shopify/Product/7","gid://shopify/Product/8"]');
  assert.equal(byKey.related_protectors, undefined);
});

test('dimensions are a variant metafield, present only when given', () => {
  const desired = toDesiredProduct(product(), context);
  assert.deepEqual(desired.variants[0].metafields, [{ namespace: 'custom', key: 'dimensions', type: 'single_line_text_field', value: '60 in x 80 in' }]);
  assert.deepEqual(desired.variants[1].metafields, []);
});

test('tags carry brand, comfort, type, line, delivery, positions and benefits; sorted and unique', () => {
  const tags = buildTags(product());
  assert.deepEqual(tags, ['benefit:Cooling', 'brand:Quillmoor Sleep', 'comfort:Medium', 'delivery:white-glove', 'line:Cloud Series', 'position:Back', 'position:Side', 'type:Hybrid']);
  assert.deepEqual(buildTags(product({ sleepPositions: ['Back', 'Back'] })).filter((tag) => tag === 'position:Back').length, 1);
});

test('mergeTags drops stale managed tags but keeps the client\'s own', () => {
  const merged = mergeTags(['Clearance', 'comfort:Firm', 'brand:Old Brand', 'staff-pick'], ['brand:New Brand', 'comfort:Medium']);
  assert.deepEqual(merged, ['Clearance', 'brand:New Brand', 'comfort:Medium', 'staff-pick']);
  assert.deepEqual(mergeTags([], ['a:b']), ['a:b']);
});

test('descriptions become escaped paragraphs; markup in the text can never reach Shopify as HTML', () => {
  assert.equal(descriptionToHtml('One.\n\nTwo\nline.'), '<p>One.</p><p>Two<br>line.</p>');
  assert.equal(descriptionToHtml('<script>alert(1)</script> & "x"'), '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;</p>');
  assert.equal(descriptionToHtml(null), '');
  assert.equal(descriptionToHtml('   '), '');
});

test('sizes are detected in file names, longest name first', () => {
  const cases = /** @type {const} */ ([
    ['cloud-king-1.jpg', 'King'],
    ['cloud-california-king.jpg', 'California King'],
    ['Cloud_Split_California_King.PNG', 'Split California King'],
    ['cloud-twin-xl-2.webp', 'Twin XL'],
    ['cloud-twin.jpg', 'Twin'],
    ['cloud-queen.jpg', 'Queen'],
    ['cloud-1.jpg', null],
    ['kingston-1.jpg', null],
  ]);
  for (const [file, size] of cases) assert.equal(detectSizeInFilename(file), size, file);
});

test('alt text uses the product title plus size and view context, without the word "image"', () => {
  assert.equal(buildAltText('Cloud Hybrid', 'cloud-hybrid-1.jpg', 0, ['Queen', 'King']), 'Cloud Hybrid');
  assert.equal(buildAltText('Cloud Hybrid', 'cloud-hybrid-2.jpg', 1, ['Queen', 'King']), 'Cloud Hybrid, view 2');
  assert.equal(buildAltText('Cloud Hybrid', 'cloud-hybrid-king.jpg', 2, ['Queen', 'King']), 'Cloud Hybrid, King size, view 3');
  assert.equal(buildAltText('Solo Model', 'solo-1.jpg', 0, ['Queen']), 'Solo Model, Queen size');
  assert.ok(buildAltText('x'.repeat(900), 'a.jpg', 0, ['Queen']).length <= MAX_ALT_LENGTH);
  assert.doesNotMatch(buildAltText('Cloud Hybrid', 'a.jpg', 3, []), /image|picture|photo/i);
});

test('desired images keep the sheet order and carry alt text', () => {
  const desired = toDesiredProduct(product(), context);
  assert.deepEqual(desired.images, [
    { fileName: 'cloud-hybrid-1.jpg', alt: 'Cloud Hybrid' },
    { fileName: 'cloud-hybrid-king.jpg', alt: 'Cloud Hybrid, King size, view 2' },
  ]);
});

test('metafield comparison ignores JSON whitespace and key order and numeric formatting', () => {
  assert.ok(metafieldValuesEqual({ type: 'list.single_line_text_field', value: '["a","b"]' }, { type: 'list.single_line_text_field', value: '[ "a", "b" ]' }));
  assert.ok(!metafieldValuesEqual({ type: 'list.single_line_text_field', value: '["a","b"]' }, { type: 'list.single_line_text_field', value: '["b","a"]' }), 'list order matters');
  assert.ok(metafieldValuesEqual({ type: 'json', value: '{"a":1,"b":2}' }, { type: 'json', value: '{"b":2,"a":1}' }));
  assert.ok(metafieldValuesEqual({ type: 'number_decimal', value: '12.0' }, { type: 'number_decimal', value: '12' }));
  assert.ok(!metafieldValuesEqual({ type: 'single_line_text_field', value: 'Medium' }, { type: 'single_line_text_field', value: 'medium' }));
  assert.ok(!metafieldValuesEqual({ type: 'json', value: 'not json' }, { type: 'json', value: '{}' }));
});

test('every product in the sample sheet maps cleanly', () => {
  const report = validateSheet(readFileSync(path.join(here, 'sample/mattresses.csv'), 'utf8'), { availableImages: null });
  assert.equal(report.products.length, 14);
  for (const entry of report.products) {
    const desired = toDesiredProduct(entry, context);
    assert.equal(desired.variants.length, entry.variants.length, entry.handle);
    assert.ok(desired.variants.every((variant) => /^\d+\.\d{2}$/.test(variant.price)), entry.handle);
    assert.ok(desired.images.every((image) => image.alt.length > 0 && image.alt.length <= MAX_ALT_LENGTH), entry.handle);
    assert.equal(desired.images.length, 2, entry.handle);
    assert.ok(desired.descriptionHtml.startsWith('<p>'), entry.handle);
    assert.ok(desired.tags.some((tag) => tag.startsWith('brand:')), entry.handle);
  }
});
