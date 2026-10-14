// The product sheet contract (REQ-CAT-001): one row per variant (size), grouped into one product per model.
// Allowed attribute values live here and nowhere else. The quiz (REQ-QZ-003), the storefront filters
// (REQ-COL-002) and scripts/shopify/definitions.json must use exactly these strings; a unit test
// compares definitions.json with this file so they cannot drift apart.

/** Canonical order: variants are created in this order whatever order the rows are in. */
export const SIZES = Object.freeze(['Twin', 'Twin XL', 'Full', 'Queen', 'King', 'California King', 'Split California King']);
export const COMFORT_LEVELS = Object.freeze(['Ultra Plush', 'Plush', 'Medium', 'Firm', 'Extra Firm']);
export const MATTRESS_TYPES = Object.freeze(['Memory Foam', 'Hybrid', 'Innerspring', 'Foam', 'Latex']);
export const BENEFITS = Object.freeze(['Cooling', 'Pressure Relief', 'Motion Separation', 'Back Support', 'Eco-Friendly']);
export const SLEEP_POSITIONS = Object.freeze(['Back', 'Side', 'Stomach']);
/** Matches the data model (SHOPIFY_DATA_MODEL: white-glove, parcel, both). */
export const DELIVERY_TYPES = Object.freeze(['white-glove', 'parcel', 'both']);

export const DEFAULT_PRODUCT_TYPE = 'Mattress';
/** Attribute columns are mandatory only for this product type; add-on products need fewer. */
export const ATTRIBUTE_REQUIRED_FOR = DEFAULT_PRODUCT_TYPE;

export const LIST_SEPARATOR = '|';
export const IMAGE_EXTENSIONS = Object.freeze(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
/** UNVERIFIED(V-05): 20 MB is the figure in Shopify's media help pages; confirm on the development store. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const LIMITS = Object.freeze({
  maxFileBytes: 5 * 1024 * 1024,
  maxRecords: 5000,
  maxModels: 400, // SOW section 8 and 12: up to 400 products, more by change request
  maxVariantsPerModel: SIZES.length,
  model: 150,
  brand: 100,
  productLine: 100,
  handle: 100,
  productType: 100,
  description: 10_000,
  bullet: 200,
  maxBullets: 12,
  softBullets: 8,
  seoTitle: 70, // hard limit; Shopify's editor counts to 70
  seoTitleSoft: 60,
  seoDescription: 320,
  seoDescriptionSoft: 160,
  dimensions: 60,
  sku: 64,
  specKey: 60,
  specValue: 200,
  maxSpecs: 40,
  imageName: 120,
  maxImages: 20,
  extendCategory: 100,
  compareGroup: 100,
  maxRelated: 12,
  minPriceCents: 5_000, // warn below $50
  maxPriceCents: 2_000_000, // warn above $20,000
  maxPriceCentsHard: 99_999_999,
  deepDiscountRatio: 0.7, // warn when the sale price is below 30% of the regular price
  heightInchesMax: 60,
});

/**
 * @typedef {'text' | 'list' | 'enum' | 'enumList' | 'money' | 'number' | 'bool' | 'handle' | 'handleList' | 'specs' | 'images' | 'sku'} ColumnKind
 * @typedef {object} Column
 * @property {string} name        header cell
 * @property {'product' | 'variant'} level  product-level cells must agree across a model's rows
 * @property {ColumnKind} kind
 * @property {boolean} [required]               required on every row
 * @property {boolean} [requiredForMattress]    required when the product type is Mattress
 * @property {number} [maxLength]
 * @property {readonly string[]} [values]       allowed values for enum kinds
 * @property {string} help        shown in the README and in messages
 * @property {string} example
 */

/** @type {readonly Column[]} */
export const COLUMNS = Object.freeze([
  { name: 'model', level: 'product', kind: 'text', required: true, maxLength: LIMITS.model, help: 'Product title shown to shoppers. Same on every size row.', example: 'Example Cloud Hybrid' },
  { name: 'brand', level: 'product', kind: 'text', required: true, maxLength: LIMITS.brand, help: 'Brand name; becomes the vendor and links to the brand page.', example: 'Example Brand' },
  { name: 'product_line', level: 'product', kind: 'text', maxLength: LIMITS.productLine, help: 'Product line or collection name within the brand.', example: 'Cloud Series' },
  { name: 'handle', level: 'product', kind: 'handle', required: true, maxLength: LIMITS.handle, help: 'URL slug: lowercase letters, digits and hyphens. The stable key that makes re-runs update instead of duplicate.', example: 'example-cloud-hybrid' },
  { name: 'product_type', level: 'product', kind: 'text', maxLength: LIMITS.productType, help: `Blank means ${DEFAULT_PRODUCT_TYPE}. Comfort, type, positions and delivery are required only for ${ATTRIBUTE_REQUIRED_FOR}.`, example: 'Mattress' },
  { name: 'size', level: 'variant', kind: 'enum', required: true, values: SIZES, help: `One of: ${SIZES.join(', ')}.`, example: 'Queen' },
  { name: 'dimensions', level: 'variant', kind: 'text', maxLength: LIMITS.dimensions, help: 'Shown next to the size, for example 60" x 80".', example: '60 in x 80 in' },
  { name: 'sku', level: 'variant', kind: 'sku', required: true, maxLength: LIMITS.sku, help: 'Unique per row. Letters, digits, dot, dash, underscore, slash.', example: 'EXC-HYB-Q' },
  { name: 'price', level: 'variant', kind: 'money', required: true, help: 'Regular price in US dollars, for example 1299.00.', example: '1299.00' },
  { name: 'sale_price', level: 'variant', kind: 'money', help: 'Optional. Must be lower than price. Stored as the price, with the regular price as compare-at.', example: '1099.00' },
  { name: 'comfort_level', level: 'product', kind: 'enum', requiredForMattress: true, values: COMFORT_LEVELS, help: `One of: ${COMFORT_LEVELS.join(', ')}.`, example: 'Medium' },
  { name: 'mattress_type', level: 'product', kind: 'enum', requiredForMattress: true, values: MATTRESS_TYPES, help: `One of: ${MATTRESS_TYPES.join(', ')}.`, example: 'Hybrid' },
  { name: 'sleep_positions', level: 'product', kind: 'enumList', requiredForMattress: true, values: SLEEP_POSITIONS, help: `One or more of ${SLEEP_POSITIONS.join(', ')}, separated by |.`, example: 'Back|Side' },
  { name: 'benefits', level: 'product', kind: 'enumList', values: BENEFITS, help: `Zero or more of ${BENEFITS.join(', ')}, separated by |.`, example: 'Cooling|Pressure Relief' },
  { name: 'height_inches', level: 'product', kind: 'number', help: 'Mattress height in inches, for example 12 or 12.5.', example: '12' },
  { name: 'delivery_type', level: 'product', kind: 'enum', requiredForMattress: true, values: DELIVERY_TYPES, help: `One of: ${DELIVERY_TYPES.join(', ')}.`, example: 'white-glove' },
  { name: 'description', level: 'product', kind: 'text', maxLength: LIMITS.description, help: 'Plain text only (no HTML). A blank line starts a new paragraph.', example: 'A medium-feel hybrid with a cooling cover.' },
  { name: 'overview_bullets', level: 'product', kind: 'list', maxLength: LIMITS.bullet, help: `Feature bullets separated by |, up to ${LIMITS.maxBullets}, each up to ${LIMITS.bullet} characters.`, example: 'Cooling cover|Zoned support' },
  { name: 'specifications', level: 'product', kind: 'specs', help: 'Label=value pairs separated by |.', example: 'Firmness=Medium|Thickness=12 in|Cover=Quilted knit' },
  { name: 'seo_title', level: 'product', kind: 'text', maxLength: LIMITS.seoTitle, help: `Search result title, up to ${LIMITS.seoTitleSoft} characters is best.`, example: 'Example Cloud Hybrid Mattress' },
  { name: 'seo_description', level: 'product', kind: 'text', maxLength: LIMITS.seoDescription, help: `Search result description, up to ${LIMITS.seoDescriptionSoft} characters is best.`, example: 'A medium hybrid mattress with a cooling cover.' },
  { name: 'images', level: 'product', kind: 'images', requiredForMattress: true, help: 'Image file names separated by |, in display order. The first is the main image.', example: 'example-cloud-hybrid-1.jpg|example-cloud-hybrid-2.jpg' },
  { name: 'extend_category', level: 'product', kind: 'text', maxLength: LIMITS.extendCategory, help: 'Extend protection category, as agreed with Extend. Leave blank if unknown.', example: 'mattress' },
  { name: 'related_foundations', level: 'product', kind: 'handleList', help: 'Handles of matching foundations or bases, separated by |.', example: 'example-foundation' },
  { name: 'related_protectors', level: 'product', kind: 'handleList', help: 'Handles of matching mattress protectors, separated by |.', example: 'example-protector' },
  { name: 'related_bedding', level: 'product', kind: 'handleList', help: 'Handles of matching bedding, separated by |.', example: 'example-pillow' },
  { name: 'compare_group', level: 'product', kind: 'text', maxLength: LIMITS.compareGroup, help: 'Products with the same value are offered as similar products in comparison.', example: 'cloud-hybrids' },
  { name: 'copy_approved', level: 'product', kind: 'bool', help: 'yes once the client approved the text (CLR-017). Unapproved products import as drafts and are not published.', example: 'no' },
]);

export const COLUMN_NAMES = Object.freeze(COLUMNS.map((column) => column.name));
export const REQUIRED_COLUMN_NAMES = Object.freeze(COLUMNS.filter((column) => column.required).map((column) => column.name));

/** @param {string} name */
export function getColumn(name) {
  return COLUMNS.find((column) => column.name === name);
}

/** Case-insensitive lookup that returns the canonical spelling. */
export function canonicalValue(/** @type {readonly string[]} */ values, /** @type {string} */ input) {
  const wanted = input.trim().toLowerCase();
  return values.find((value) => value.toLowerCase() === wanted) ?? null;
}

export const TRUE_WORDS = Object.freeze(['yes', 'y', 'true', '1', 'approved']);
export const FALSE_WORDS = Object.freeze(['no', 'n', 'false', '0', '']);

export const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Everything the importer writes into Shopify metafields lives under this namespace (SHOPIFY_DATA_MODEL). */
export const METAFIELD_NAMESPACE = 'custom';
