import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyCsv } from './csv.mjs';
import { BENEFITS, COLUMN_NAMES, COMFORT_LEVELS, LIMITS, MATTRESS_TYPES, SIZES, SLEEP_POSITIONS } from './schema.mjs';
import { ISSUE_CODES, loadAvailableImages, main, parseMoneyToCents, renderConsoleSummary, renderMarkdownReport, validateSheet } from './validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (/** @type {string} */ relative) => readFileSync(path.join(here, relative), 'utf8');

/** A valid Queen row for one model; tests override exactly what they want to break. */
const row = (/** @type {Record<string, string>} */ over = {}) => ({
  model: 'Test Model', brand: 'Test Brand', handle: 'test-model', size: 'Queen', dimensions: '60 in x 80 in', sku: 'TM-Q', price: '1000.00', comfort_level: 'Medium', mattress_type: 'Hybrid',
  sleep_positions: 'Back', height_inches: '10', delivery_type: 'white-glove', description: 'Sample copy.', overview_bullets: 'One|Two', seo_title: 'Test Model', seo_description: 'Sample.',
  images: 'test-model-1.jpg', copy_approved: 'yes', ...over,
});
const sheet = (/** @type {Record<string, string>[]} */ ...rows) => stringifyCsv([COLUMN_NAMES, ...rows.map((entry) => COLUMN_NAMES.map((name) => entry[name] ?? ''))]);
const codes = (/** @type {import('./validate.mjs').ValidationReport} */ report) => report.issues.map((issue) => issue.code);
const has = (/** @type {import('./validate.mjs').ValidationReport} */ report, /** @type {string} */ code, /** @type {number | undefined} */ at) =>
  report.issues.some((issue) => issue.code === code && (at === undefined || issue.row === at));
const NO_IMAGE_CHECK = { availableImages: null };

// ---- the shipped files ---------------------------------------------------------------------------------

test('the sample sheet passes: 14 models, 80 sizes, zero errors, both approved and unapproved copy', () => {
  const images = new Set(read('sample/images.txt').split(/\r?\n/).filter((line) => line && !line.startsWith('#')));
  const report = validateSheet(read('sample/mattresses.csv'), { availableImages: images });
  assert.equal(report.summary.errors, 0, JSON.stringify(report.issues.filter((issue) => issue.severity === 'error')));
  assert.equal(report.ok, true);
  assert.equal(report.summary.models, 14);
  assert.equal(report.summary.variants, 80);
  assert.ok(report.summary.approvedModels > 0 && report.summary.unapprovedModels > 0);
  assert.equal(report.summary.imagesChecked, true);
  assert.equal(report.products.length, 14);
  // fictional brands only: no sample brand may match the sheet's own example brand
  assert.ok(new Set(report.products.map((product) => product.brand)).size >= 4);
  // every size is valid and in canonical order
  for (const product of report.products) {
    const positions = product.variants.map((variant) => SIZES.indexOf(variant.size));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), product.handle);
    assert.ok(positions.every((position) => position >= 0));
  }
});

test('the sample sheet only uses allowed attribute values', () => {
  const report = validateSheet(read('sample/mattresses.csv'), NO_IMAGE_CHECK);
  for (const product of report.products) {
    assert.ok(COMFORT_LEVELS.includes(/** @type {string} */ (product.comfortLevel)), product.handle);
    assert.ok(MATTRESS_TYPES.includes(/** @type {string} */ (product.mattressType)), product.handle);
    assert.ok(product.sleepPositions.every((value) => SLEEP_POSITIONS.includes(value)), product.handle);
    assert.ok(product.benefits.every((value) => BENEFITS.includes(value)), product.handle);
  }
});

test('the template (header plus two example rows) validates and shows the inherit-from-first-row convention', () => {
  const report = validateSheet(read('template/products.csv'), NO_IMAGE_CHECK);
  assert.equal(report.summary.errors, 0, JSON.stringify(report.issues));
  assert.equal(report.summary.models, 1);
  assert.equal(report.summary.variants, 2);
  assert.equal(read('template/products.csv').trim().split(/\r?\n/).length, 3);
  assert.deepEqual(read('template/products.csv').split(/\r?\n/)[0].split(','), [...COLUMN_NAMES]);
});

const invalidText = read('sample/invalid.csv');
const expectations = /** @type {{ expected: { row: number, code: string, why: string }[] }} */ (JSON.parse(read('sample/invalid.expected.json'))).expected;
// every image in the invalid sheet exists except the one that is meant to be missing
const invalidImages = new Set((invalidText.match(/[A-Za-z0-9._-]+\.jpg/g) ?? []).filter((name) => name !== 'missing-image-1.jpg'));

test('the invalid sample sheet fails, produces every expected error on its row, and returns no products', () => {
  const report = validateSheet(invalidText, { availableImages: invalidImages });
  assert.equal(report.ok, false);
  assert.ok(report.summary.errors >= expectations.length);
  assert.deepEqual(report.products, [], 'no data may flow on to the importer');
  for (const expected of expectations) {
    assert.ok(has(report, expected.code, expected.row), `row ${expected.row} should report ${expected.code} (${expected.why})`);
  }
});

test('invalid sheet: no error appears on a row that was not expected to have one', () => {
  const report = validateSheet(invalidText, { availableImages: invalidImages });
  const allowedRows = new Set(expectations.map((expected) => expected.row));
  const stray = report.issues.filter((issue) => issue.severity === 'error' && issue.row !== null && !allowedRows.has(issue.row));
  assert.deepEqual(stray, []);
});

/** Header and file-level error codes cannot occur in a data row, so they are exercised with inline text. */
const INLINE_CASES = /** @type {Record<string, () => import('./validate.mjs').ValidationReport>} */ ({
  E_FILE_EMPTY: () => validateSheet(''),
  E_FILE_TOO_LARGE: () => validateSheet('x'.repeat(LIMITS.maxFileBytes + 1)),
  E_CSV_PARSE: () => validateSheet('model,brand\n"never closed,1\n'),
  E_HEADER_MISSING: () => validateSheet(stringifyCsv([COLUMN_NAMES.filter((name) => name !== 'sku'), ['x']])),
  E_HEADER_DUPLICATE: () => validateSheet(stringifyCsv([[...COLUMN_NAMES, 'sku'], ['x']])),
  E_CONTROL_CHARS: () => validateSheet(sheet(row({ description: 'bad\u0001text' }))),
});

test('every error code the validator can emit is demonstrated by the invalid sheet or an inline case', () => {
  const seen = new Set(codes(validateSheet(invalidText, { availableImages: invalidImages })));
  for (const [code, run] of Object.entries(INLINE_CASES)) {
    assert.ok(has(run(), code), `inline case for ${code} must produce it`);
    seen.add(code);
  }
  const uncovered = Object.entries(ISSUE_CODES).filter(([code, severity]) => severity === 'error' && !seen.has(code)).map(([code]) => code);
  assert.deepEqual(uncovered, [], 'add an example row to invalid.csv (and invalid.expected.json) or an inline case');
});

// ---- price and sale-price rules ----------------------------------------------------------------------------

test('parseMoneyToCents accepts dollars with optional symbol, commas and up to two decimals', () => {
  assert.equal(parseMoneyToCents('1299'), 129900);
  assert.equal(parseMoneyToCents('1,299.00'), 129900);
  assert.equal(parseMoneyToCents('$1299.5'), 129950);
  assert.equal(parseMoneyToCents('0.99'), 99);
  for (const bad of ['', '-5', '12.345', '1,29.00', 'abc', '1e3', '12,34', '$', '1299.']) assert.equal(parseMoneyToCents(bad), null, bad);
});

test('price formats become integer cents and sale price must be lower than the price', () => {
  const report = validateSheet(sheet(row({ price: '$1,299.50', sale_price: '1099' })), NO_IMAGE_CHECK);
  assert.equal(report.summary.errors, 0);
  assert.equal(report.products[0].variants[0].priceCents, 129950);
  assert.equal(report.products[0].variants[0].salePriceCents, 109900);
});

test('a sale price equal to or above the price is an error on that row; zero and negative prices are errors', () => {
  for (const sale of ['1000.00', '1200.00']) assert.ok(has(validateSheet(sheet(row({ sale_price: sale })), NO_IMAGE_CHECK), 'E_SALE_NOT_LOWER', 2), sale);
  for (const price of ['0', '-10', 'free', '12.345']) assert.ok(has(validateSheet(sheet(row({ price })), NO_IMAGE_CHECK), 'E_BAD_PRICE', 2), price);
  assert.ok(has(validateSheet(sheet(row({ price: '', sale_price: '500' })), NO_IMAGE_CHECK), 'E_REQUIRED'));
});

test('suspicious but legal prices only warn', () => {
  assert.ok(has(validateSheet(sheet(row({ price: '10.00' })), NO_IMAGE_CHECK), 'W_PRICE_UNUSUAL'));
  assert.ok(has(validateSheet(sheet(row({ price: '30000.00' })), NO_IMAGE_CHECK), 'W_PRICE_UNUSUAL'));
  assert.ok(has(validateSheet(sheet(row({ sale_price: '200.00' })), NO_IMAGE_CHECK), 'W_DEEP_DISCOUNT'));
  assert.equal(validateSheet(sheet(row({ sale_price: '200.00' })), NO_IMAGE_CHECK).summary.errors, 0);
});

test('a larger size that costs less than a smaller one is flagged', () => {
  const report = validateSheet(sheet(row(), row({ size: 'King', sku: 'TM-K', price: '900.00' })), NO_IMAGE_CHECK);
  assert.ok(has(report, 'W_PRICE_SIZE_ORDER', 3));
  assert.equal(report.summary.errors, 0);
});

// ---- duplicates --------------------------------------------------------------------------------------------

test('duplicate SKUs are errors across products and compared case-insensitively', () => {
  const report = validateSheet(sheet(row(), row({ handle: 'other', model: 'Other', sku: 'tm-q' })), NO_IMAGE_CHECK);
  assert.ok(has(report, 'E_DUPLICATE_SKU', 3));
  assert.match(report.issues.find((issue) => issue.code === 'E_DUPLICATE_SKU')?.message ?? '', /row 2/);
});

test('the same size twice for one product is an error; the same model under two handles is an error', () => {
  assert.ok(has(validateSheet(sheet(row(), row({ sku: 'TM-Q2' })), NO_IMAGE_CHECK), 'E_DUPLICATE_SIZE', 3));
  assert.ok(has(validateSheet(sheet(row(), row({ handle: 'test-model-copy', sku: 'TM-Q2' })), NO_IMAGE_CHECK), 'E_DUPLICATE_MODEL'));
});

test('two different models cannot share a handle: the second disagrees on a product-level value', () => {
  const report = validateSheet(sheet(row(), row({ model: 'Another Model', size: 'King', sku: 'TM-K' })), NO_IMAGE_CHECK);
  assert.ok(has(report, 'E_INCONSISTENT_ATTRIBUTE', 3));
});

test('rows of one product need not be adjacent, but the report says so', () => {
  const report = validateSheet(sheet(row(), row({ handle: 'b', model: 'B', sku: 'B-Q', images: 'b-1.jpg' }), row({ size: 'King', sku: 'TM-K', price: '1200.00' })), NO_IMAGE_CHECK);
  assert.ok(has(report, 'W_ROWS_NOT_GROUPED', 4));
  assert.equal(report.summary.errors, 0);
  assert.equal(report.products.find((product) => product.handle === 'test-model')?.variants.length, 2);
});

// ---- attribute values --------------------------------------------------------------------------------------

test('unknown attribute values are errors that name the allowed values and suggest a close match', () => {
  const report = validateSheet(sheet(row({ comfort_level: 'Plsh', mattress_type: 'Gel', sleep_positions: 'Back|Belly', benefits: 'Cooling|Quiet', delivery_type: 'courier', size: 'Quen' })), NO_IMAGE_CHECK);
  const unknown = report.issues.filter((issue) => issue.code === 'E_UNKNOWN_VALUE');
  assert.deepEqual(unknown.map((issue) => issue.column).sort(), ['benefits', 'comfort_level', 'delivery_type', 'mattress_type', 'size', 'sleep_positions']);
  assert.match(unknown.find((issue) => issue.column === 'comfort_level')?.message ?? '', /Ultra Plush, Plush, Medium, Firm, Extra Firm.*Did you mean "Plush"\?/);
  assert.match(unknown.find((issue) => issue.column === 'size')?.message ?? '', /Did you mean "Queen"\?/);
});

test('allowed values are matched case-insensitively, normalised with a warning, and de-duplicated', () => {
  const report = validateSheet(sheet(row({ mattress_type: 'memory foam', sleep_positions: 'back|SIDE|Back', benefits: 'pressure relief' })), NO_IMAGE_CHECK);
  assert.equal(report.summary.errors, 0);
  assert.equal(report.products[0].mattressType, 'Memory Foam');
  assert.deepEqual(report.products[0].sleepPositions, ['Back', 'Side']);
  assert.deepEqual(report.products[0].benefits, ['Pressure Relief']);
  assert.ok(has(report, 'W_VALUE_NORMALISED'));
});

test('the schema lists are exactly the agreed quiz and filter values', () => {
  assert.deepEqual([...SIZES], ['Twin', 'Twin XL', 'Full', 'Queen', 'King', 'California King', 'Split California King']);
  assert.deepEqual([...COMFORT_LEVELS], ['Ultra Plush', 'Plush', 'Medium', 'Firm', 'Extra Firm']);
  assert.deepEqual([...MATTRESS_TYPES], ['Memory Foam', 'Hybrid', 'Innerspring', 'Foam', 'Latex']);
  assert.deepEqual([...BENEFITS], ['Cooling', 'Pressure Relief', 'Motion Separation', 'Back Support', 'Eco-Friendly']);
  assert.deepEqual([...SLEEP_POSITIONS], ['Back', 'Side', 'Stomach']);
});

test('height must be a plausible positive number of inches', () => {
  for (const bad of ['tall', '0', '-3', '99', '12.345']) assert.ok(has(validateSheet(sheet(row({ height_inches: bad })), NO_IMAGE_CHECK), 'E_BAD_NUMBER'), bad);
  assert.equal(validateSheet(sheet(row({ height_inches: '12.5' })), NO_IMAGE_CHECK).products[0].heightInches, '12.5');
});

test('copy_approved accepts yes/no style words and rejects anything else', () => {
  for (const [value, approved] of [['yes', true], ['Y', true], ['TRUE', true], ['no', false], ['', false]]) {
    assert.equal(validateSheet(sheet(row({ copy_approved: value })), NO_IMAGE_CHECK).products[0].copyApproved, approved, value);
  }
  assert.ok(has(validateSheet(sheet(row({ copy_approved: 'maybe' })), NO_IMAGE_CHECK), 'E_BAD_BOOLEAN'));
});

// ---- consistency across the sizes of one model -----------------------------------------------------------------

test('every size of a model must agree on product-level attributes; blanks inherit from the first row', () => {
  const inherit = validateSheet(sheet(row(), row({ size: 'King', sku: 'TM-K', price: '1200.00', model: '', brand: '', comfort_level: '', mattress_type: '', sleep_positions: '', delivery_type: '', images: '', description: '', copy_approved: '' })), NO_IMAGE_CHECK);
  assert.equal(inherit.summary.errors, 0, JSON.stringify(inherit.issues));
  assert.equal(inherit.products[0].variants.length, 2);

  const clash = validateSheet(sheet(row(), row({ size: 'King', sku: 'TM-K', price: '1200.00', comfort_level: 'Firm', sleep_positions: 'Stomach', images: 'other.jpg', delivery_type: 'parcel' })), NO_IMAGE_CHECK);
  const clashing = clash.issues.filter((issue) => issue.code === 'E_INCONSISTENT_ATTRIBUTE').map((issue) => issue.column).sort();
  assert.deepEqual(clashing, ['comfort_level', 'delivery_type', 'images', 'sleep_positions']);
  assert.ok(clash.issues.every((issue) => issue.code !== 'E_INCONSISTENT_ATTRIBUTE' || issue.row === 3));
});

test('a value given only on a later row still counts for the model', () => {
  const report = validateSheet(sheet(row({ description: '' }), row({ size: 'King', sku: 'TM-K', price: '1200.00', description: 'Later row copy.' })), NO_IMAGE_CHECK);
  assert.equal(report.summary.errors, 0);
  assert.equal(report.products[0].description, 'Later row copy.');
});

test('mattress-only attributes are required for mattresses but not for other product types', () => {
  const mattress = validateSheet(sheet(row({ comfort_level: '', mattress_type: '', sleep_positions: '', delivery_type: '', images: '' })), NO_IMAGE_CHECK);
  assert.deepEqual(mattress.issues.filter((issue) => issue.code === 'E_REQUIRED').map((issue) => issue.column).sort(), ['comfort_level', 'delivery_type', 'images', 'mattress_type', 'sleep_positions']);
  const protector = validateSheet(sheet(row({ product_type: 'Protector', comfort_level: '', mattress_type: '', sleep_positions: '', delivery_type: '', images: '' })), NO_IMAGE_CHECK);
  assert.equal(protector.summary.errors, 0, JSON.stringify(protector.issues));
  assert.equal(protector.products[0].productType, 'Protector');
});

test('model, brand and the variant columns are required for every product type', () => {
  const report = validateSheet(sheet(row({ product_type: 'Protector', model: '', brand: '', size: '', sku: '', price: '' })), NO_IMAGE_CHECK);
  const missing = report.issues.filter((issue) => issue.code === 'E_REQUIRED').map((issue) => issue.column).sort();
  assert.deepEqual(missing, ['brand', 'model', 'price', 'size', 'sku']);
});

// ---- images -------------------------------------------------------------------------------------------------

test('image names are checked for format; path tricks and non-images are rejected', () => {
  for (const images of ['../secret.jpg', 'folder/a.jpg', 'a.txt', 'a.jpg|a.jpg', 'a b.exe', 'C:\\x.jpg']) {
    const report = validateSheet(sheet(row({ images })), NO_IMAGE_CHECK);
    assert.ok(has(report, 'E_BAD_IMAGE_NAME') || has(report, 'E_DUPLICATE_IMAGE'), images);
  }
  assert.equal(validateSheet(sheet(row({ images: 'front view.JPG|Side_2.png|three(3).webp' })), NO_IMAGE_CHECK).summary.errors, 0);
});

test('images are matched against the folder listing; case differences are explained; extras are warned about', () => {
  const available = new Set(['TEST-MODEL-1.jpg', 'unused.png']);
  const report = validateSheet(sheet(row()), { availableImages: available });
  assert.ok(has(report, 'E_MISSING_IMAGE', 2));
  assert.match(report.issues.find((issue) => issue.code === 'E_MISSING_IMAGE')?.message ?? '', /TEST-MODEL-1\.jpg.*case-sensitive/);
  assert.ok(has(report, 'W_UNREFERENCED_IMAGE'));
  assert.equal(report.summary.imagesChecked, true);
  const ok = validateSheet(sheet(row()), { availableImages: new Set(['test-model-1.jpg']) });
  assert.equal(ok.summary.errors, 0);
  assert.ok(!has(ok, 'W_UNREFERENCED_IMAGE'));
});

test('without an image listing the check is skipped and the report says so', () => {
  const report = validateSheet(sheet(row()), NO_IMAGE_CHECK);
  assert.ok(has(report, 'W_IMAGES_NOT_CHECKED'));
  assert.equal(report.summary.imagesChecked, false);
});

test('the same image on two products is a warning, not an error', () => {
  const report = validateSheet(sheet(row(), row({ handle: 'b', model: 'B', sku: 'B-Q' })), NO_IMAGE_CHECK);
  assert.ok(has(report, 'W_IMAGE_SHARED'));
  assert.equal(report.summary.errors, 0);
});

// ---- size handling -------------------------------------------------------------------------------------------

test('sizes out of order only warn, and variants are always produced in canonical order', () => {
  const report = validateSheet(sheet(row({ size: 'King', sku: 'TM-K', price: '1200.00' }), row({ sku: 'TM-Q' })), NO_IMAGE_CHECK);
  assert.ok(has(report, 'W_SIZE_ORDER'));
  assert.deepEqual(report.products[0].variants.map((variant) => variant.size), ['Queen', 'King']);
});

// ---- text rules ----------------------------------------------------------------------------------------------

test('formula injection and HTML in any text column are errors on that row and column', () => {
  for (const [column, value, code] of /** @type {const} */ ([
    ['description', '=HYPERLINK("http://x","y")', 'E_FORMULA'],
    ['seo_title', '+1 555', 'E_FORMULA'],
    ['model', '-cmd', 'E_FORMULA'],
    ['brand', '@SUM(1)', 'E_FORMULA'],
    ['specifications', '=x=1', 'E_FORMULA'],
    ['description', '<script>alert(1)</script>', 'E_HTML'],
    ['overview_bullets', 'Nice|<b>bold</b>', 'E_HTML'],
    ['seo_description', '<img src=x onerror=alert(1)>', 'E_HTML'],
  ])) {
    const report = validateSheet(sheet(row({ [column]: value })), NO_IMAGE_CHECK);
    const hit = report.issues.find((issue) => issue.code === code && issue.column === column);
    assert.ok(hit, `${column}=${value}`);
    assert.equal(hit?.row, 2);
    assert.equal(report.ok, false);
    assert.deepEqual(report.products, []);
  }
});

test('over-long cells, specifications, bullets and related handles are errors', () => {
  assert.ok(has(validateSheet(sheet(row({ seo_title: 'x'.repeat(LIMITS.seoTitle + 1) })), NO_IMAGE_CHECK), 'E_TOO_LONG'));
  assert.ok(has(validateSheet(sheet(row({ model: 'x'.repeat(LIMITS.model + 1) })), NO_IMAGE_CHECK), 'E_TOO_LONG'));
  assert.ok(has(validateSheet(sheet(row({ overview_bullets: 'y'.repeat(LIMITS.bullet + 1) })), NO_IMAGE_CHECK), 'E_TOO_LONG'));
  assert.ok(has(validateSheet(sheet(row({ overview_bullets: Array.from({ length: LIMITS.maxBullets + 1 }, (_, i) => `b${i}`).join('|') })), NO_IMAGE_CHECK), 'E_TOO_MANY_ITEMS'));
  assert.ok(has(validateSheet(sheet(row({ specifications: Array.from({ length: LIMITS.maxSpecs + 1 }, (_, i) => `k${i}=v`).join('|') })), NO_IMAGE_CHECK), 'E_TOO_MANY_ITEMS'));
  assert.ok(has(validateSheet(sheet(row({ overview_bullets: Array.from({ length: LIMITS.softBullets + 1 }, (_, i) => `b${i}`).join('|') })), NO_IMAGE_CHECK), 'W_BULLETS_MANY'));
  assert.ok(has(validateSheet(sheet(row({ seo_title: 'x'.repeat(LIMITS.seoTitleSoft + 1) })), NO_IMAGE_CHECK), 'W_SEO_TITLE_LONG'));
  assert.ok(has(validateSheet(sheet(row({ seo_description: 'x'.repeat(LIMITS.seoDescriptionSoft + 1) })), NO_IMAGE_CHECK), 'W_SEO_DESCRIPTION_LONG'));
});

test('specifications must be label=value pairs with unique labels', () => {
  const ok = validateSheet(sheet(row({ specifications: 'Firmness=Medium|Cover=Quilted = knit' })), NO_IMAGE_CHECK);
  assert.deepEqual(ok.products[0].specifications, [{ label: 'Firmness', value: 'Medium' }, { label: 'Cover', value: 'Quilted = knit' }]);
  for (const bad of ['Thickness 12 in', '=value', 'Label=', 'A=1|a=2']) assert.ok(has(validateSheet(sheet(row({ specifications: bad })), NO_IMAGE_CHECK), 'E_BAD_SPEC') || has(validateSheet(sheet(row({ specifications: bad })), NO_IMAGE_CHECK), 'E_FORMULA'), bad);
});

test('related handles must be valid handles and a product cannot relate to itself', () => {
  assert.ok(has(validateSheet(sheet(row({ related_foundations: 'Not A Handle' })), NO_IMAGE_CHECK), 'E_BAD_RELATED_HANDLE'));
  assert.ok(has(validateSheet(sheet(row({ related_protectors: 'test-model' })), NO_IMAGE_CHECK), 'E_BAD_RELATED_HANDLE'));
  const good = validateSheet(sheet(row({ related_foundations: 'base-a|base-b' })), NO_IMAGE_CHECK);
  assert.deepEqual(good.products[0].relatedFoundations, ['base-a', 'base-b']);
});

test('handles and SKUs must be well formed', () => {
  // "-leading" is caught earlier as a formula starter; either way it is an error and nothing is imported
  for (const handle of ['Bad Handle', 'UPPER', 'trailing-', '-leading', 'double--dash', 'ünïcode']) {
    const report = validateSheet(sheet(row({ handle })), NO_IMAGE_CHECK);
    assert.ok(has(report, 'E_BAD_HANDLE') || has(report, 'E_FORMULA'), handle);
    assert.equal(report.ok, false, handle);
  }
  for (const sku of ['BAD SKU', '-leading', 'semi;colon']) assert.ok(has(validateSheet(sheet(row({ sku })), NO_IMAGE_CHECK), 'E_BAD_SKU') || has(validateSheet(sheet(row({ sku })), NO_IMAGE_CHECK), 'E_FORMULA'), sku);
});

test('copy that is not approved imports as a draft (warned); approved copy needs all text present', () => {
  const draft = validateSheet(sheet(row({ copy_approved: 'no' })), NO_IMAGE_CHECK);
  assert.ok(has(draft, 'W_UNAPPROVED_COPY'));
  assert.equal(draft.products[0].copyApproved, false);
  assert.ok(has(validateSheet(sheet(row({ copy_approved: 'yes', description: '', seo_title: '' })), NO_IMAGE_CHECK), 'E_APPROVED_WITHOUT_COPY'));
  const missing = validateSheet(sheet(row({ copy_approved: 'no', description: '' })), NO_IMAGE_CHECK);
  assert.ok(has(missing, 'W_MISSING_COPY'));
  assert.equal(missing.summary.errors, 0);
});

// ---- header handling and file-level checks --------------------------------------------------------------------

test('headers are matched case-insensitively with spaces or dashes; unknown columns are ignored with a warning', () => {
  const renamed = COLUMN_NAMES.map((name) => (name === 'sale_price' ? 'Sale Price' : name === 'comfort_level' ? 'Comfort-Level' : name));
  const text = stringifyCsv([[...renamed, 'Internal Notes'], [...COLUMN_NAMES.map((name) => row({ sale_price: '900' })[name] ?? ''), 'ignored']]);
  const report = validateSheet(text, NO_IMAGE_CHECK);
  assert.equal(report.summary.errors, 0, JSON.stringify(report.issues));
  assert.equal(report.products[0].variants[0].salePriceCents, 90000);
  assert.ok(report.issues.some((issue) => issue.code === 'W_HEADER_UNKNOWN' && issue.column === 'internal_notes'));
});

test('a UTF-8 byte order mark in the file does not break the first header', () => {
  const text = `\ufeff${sheet(row())}`;
  assert.equal(validateSheet(text, NO_IMAGE_CHECK).summary.errors, 0);
});

test('a semicolon-separated export gets a helpful message', () => {
  const report = validateSheet('model;brand;handle\nA;B;c\n');
  assert.ok(has(report, 'E_HEADER_MISSING'));
  assert.match(report.issues[0].message, /CSV UTF-8/);
});

test('rows with extra or missing cells are reported with the row number', () => {
  const header = COLUMN_NAMES.join(',');
  const good = COLUMN_NAMES.map((name) => row()[name] ?? '').join(',');
  const extra = validateSheet(`${header}\n${good},extra,cells\n`, NO_IMAGE_CHECK);
  assert.ok(has(extra, 'E_ROW_TOO_MANY_CELLS', 2));
  const short = validateSheet(`${header}\nTest Model,Test Brand\n`, NO_IMAGE_CHECK);
  assert.ok(has(short, 'W_ROW_TOO_FEW_CELLS', 2));
});

test('fully blank rows are ignored and do not shift later row numbers', () => {
  const lines = sheet(row({ price: 'bad' })).split('\r\n');
  const withBlank = [lines[0], ',,,,,', lines[1]].join('\r\n');
  assert.ok(has(validateSheet(withBlank, NO_IMAGE_CHECK), 'E_BAD_PRICE', 3));
});

test('more than 400 models warns that the agreed scope is exceeded', () => {
  const rows = Array.from({ length: 401 }, (_, i) => row({ handle: `m-${i}`, model: `M ${i}`, sku: `M-${i}`, images: `m-${i}.jpg` }));
  const report = validateSheet(sheet(...rows), NO_IMAGE_CHECK);
  assert.ok(has(report, 'W_OVER_MODEL_LIMIT'));
  assert.equal(report.summary.models, 401);
});

test('too many rows is a file-level error', () => {
  const report = validateSheet(`${COLUMN_NAMES.join(',')}\n${'x\n'.repeat(LIMITS.maxRecords + 1)}`);
  assert.ok(has(report, 'E_FILE_TOO_LARGE'));
});

test('strict mode turns warnings into a failure; normal mode does not', () => {
  const text = sheet(row({ copy_approved: 'no' }));
  assert.equal(validateSheet(text, NO_IMAGE_CHECK).ok, true);
  assert.equal(validateSheet(text, { availableImages: null, strict: true }).ok, false);
});

test('issues are ordered by row with errors before warnings and carry handle and column', () => {
  const report = validateSheet(sheet(row({ price: 'x' }), row({ handle: 'b', model: 'B', sku: 'B', size: 'Queen Plus' })), NO_IMAGE_CHECK);
  const rows = report.issues.map((issue) => issue.row ?? 0);
  assert.deepEqual(rows, [...rows].sort((a, b) => a - b));
  assert.ok(report.issues.some((issue) => issue.handle === 'test-model' && issue.column === 'price'));
});

// ---- reports --------------------------------------------------------------------------------------------------

test('the Markdown report states the result, explains errors versus warnings, and lists rows', () => {
  const report = validateSheet(invalidText, { availableImages: invalidImages });
  const markdown = renderMarkdownReport(report, { source: 'invalid.csv' });
  assert.match(markdown, /\*\*Result: FAILED\*\*/);
  assert.match(markdown, /## Errors \(\d+\)/);
  assert.match(markdown, /## Warnings \(\d+\)/);
  assert.match(markdown, /Errors\*\* must be fixed/);
  assert.match(markdown, /\| 5 \| description \| E_FORMULA \|/);
  assert.doesNotMatch(markdown, /W_MISSING_COPY \| Copy still to be drafted: description\./, 'a rejected cell is not also reported as blank');
  const passing = renderMarkdownReport(validateSheet(read('sample/mattresses.csv'), NO_IMAGE_CHECK));
  assert.match(passing, /\*\*Result: PASSED\*\*/);
  assert.match(passing, /## Models/);
});

test('hostile cell contents cannot break out of the Markdown report table', () => {
  const report = validateSheet(sheet(row({ mattress_type: 'a|b*c_d`e[f](http://x) {g}' })), NO_IMAGE_CHECK);
  const markdown = renderMarkdownReport(report);
  const line = markdown.split('\n').find((candidate) => candidate.includes('E_UNKNOWN_VALUE'));
  assert.ok(line, 'expected an E_UNKNOWN_VALUE line');
  const cells = String(line).split(/(?<!\\)\|/);
  assert.equal(cells.length, 6, `unexpected cell split: ${line}`);
  assert.equal(/(?<!\\)[[\]()`*_{}]/.test(cells[4]), false, cells[4]);
});

test('the console summary is compact and caps the number of lines', () => {
  const small = renderConsoleSummary(validateSheet(invalidText, { availableImages: invalidImages }));
  assert.match(small, /^FAILED:/);
  assert.doesNotMatch(small, /more \(see/);
  const many = Array.from({ length: 80 }, (_, i) => row({ handle: `m-${i}`, model: `M ${i}`, sku: `M-${i}`, price: 'bad' }));
  const text = renderConsoleSummary(validateSheet(sheet(...many), NO_IMAGE_CHECK));
  assert.ok(text.split('\n').length <= 45, `${text.split('\n').length} lines`);
  assert.match(text, /\.\.\. \d+ more \(see --report or --json\)/);
});

// ---- CLI ----------------------------------------------------------------------------------------------------------

/** @param {readonly string[]} argv */
async function runCli(argv) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const code = await main(argv, { out: (text) => out.push(text), err: (text) => err.push(text) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('CLI: exit code 0 for a passing sheet, 1 for errors, and it writes the JSON and Markdown reports', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'validate-cli-'));
  try {
    const good = path.join(dir, 'good.csv');
    const bad = path.join(dir, 'bad.csv');
    await writeFile(good, read('sample/mattresses.csv'));
    await writeFile(bad, invalidText);

    const pass = await runCli([good, '--json', path.join(dir, 'good.json'), '--report', path.join(dir, 'good.md')]);
    assert.equal(pass.code, 0, pass.err);
    assert.match(pass.out, /^PASSED/);
    assert.equal(JSON.parse(await readFile(path.join(dir, 'good.json'), 'utf8')).summary.models, 14);
    assert.match(await readFile(path.join(dir, 'good.md'), 'utf8'), /Result: PASSED/);

    const fail = await runCli([bad]);
    assert.equal(fail.code, 1);
    assert.match(fail.out, /^FAILED/);

    const strict = await runCli([good, '--strict']);
    assert.equal(strict.code, 1, 'warnings fail in strict mode');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI: --images accepts a folder or a list file and flags missing files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'validate-images-'));
  try {
    const csv = path.join(dir, 'one.csv');
    await writeFile(csv, sheet(row()));
    const images = path.join(dir, 'images');
    await mkdir(images);
    const missing = await runCli([csv, '--images', images]);
    assert.equal(missing.code, 1);
    assert.match(missing.out, /E_MISSING_IMAGE/);
    await writeFile(path.join(images, 'test-model-1.jpg'), 'not really an image');
    assert.equal((await runCli([csv, '--images', images])).code, 0);
    const list = path.join(dir, 'list.txt');
    await writeFile(list, '# comment\ntest-model-1.jpg\n');
    assert.equal((await runCli([csv, '--images', list])).code, 0);
    assert.deepEqual([...(await loadAvailableImages(list))], ['test-model-1.jpg']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI: usage problems and unreadable files exit with 2 and never throw', async () => {
  assert.equal((await runCli([])).code, 2);
  assert.equal((await runCli(['a.csv', 'b.csv'])).code, 2);
  assert.equal((await runCli(['a.csv', '--bogus'])).code, 2);
  const missing = await runCli([path.join(os.tmpdir(), 'definitely-not-here-123.csv')]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /Could not read/);
});
