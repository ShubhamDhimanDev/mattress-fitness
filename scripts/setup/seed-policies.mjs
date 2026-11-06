// Publishes the policy documents of docs/content/policies/ to a Shopify store: the privacy and refund policies (Settings >
// Policies) and the two pages the footer links to (Website Accessibility, Submission Terms). The storefront reads all four
// from Shopify, so this is the step that makes them appear on the site. Copied at the owner's request, see DEC-152.
//
// Dry run by default: reads the files, lists what would be written and sends nothing. A live run needs STORE,
// SHOPIFY_ADMIN_API_ACCESS_TOKEN with the `write_legal_policies` and `write_content` scopes, and SHOPIFY_ALLOWED_STORES
// (a store not listed is refused). It overwrites the store's current policy text of those two kinds, so look at the dry run.
//   bash scripts/setup/with-admin-token.sh node scripts/setup/seed-policies.mjs                              # dry run
//   bash scripts/setup/with-admin-token.sh node scripts/setup/seed-policies.mjs --live --allow-placeholders  # development store
//   bash scripts/setup/with-admin-token.sh node scripts/setup/seed-policies.mjs --live                      # only when no [CONFIRM: ...] is left
// UNVERIFIED against a store: the mutations follow the Admin GraphQL reference (shopPolicyUpdate, pageCreate, pageUpdate).

import {readFile} from 'node:fs/promises';
import {createAdminClient, readPayload} from '../lib/shopify-admin.mjs';
import {POLICY_DOCUMENTS, findPlaceholders, stripLeadingComment} from './policies-lib.mjs';

const live = process.argv.includes('--live');
const allowPlaceholders = process.argv.includes('--allow-placeholders');
const {STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN, SHOPIFY_ALLOWED_STORES: ALLOWED = ''} = process.env;

const documents = [];
for (const document of POLICY_DOCUMENTS) {
  const raw = await readFile(new URL(`../../docs/content/policies/${document.file}`, import.meta.url), 'utf8');
  const body = stripLeadingComment(raw);
  documents.push({...document, body, placeholders: findPlaceholders(body)});
}

for (const document of documents) {
  const target = document.kind === 'policy' ? `policy ${document.policyType}` : `page /pages/${document.handle}`;
  console.log(`${live ? 'LIVE' : 'DRY RUN'} ${target} <- ${document.file} (${document.body.length} characters, ${document.placeholders.length} [CONFIRM] left)`);
}
const open = documents.reduce((sum, document) => sum + document.placeholders.length, 0);

if (!live) {
  console.log(`${documents.length} documents would be written. Nothing was sent. Add --live to write them.`);
  if (open > 0) console.log(`${open} [CONFIRM: ...] markers are still in the text: a live run refuses without --allow-placeholders.`);
  process.exit(0);
}
if (open > 0 && !allowPlaceholders) {
  console.error(`Refused: ${open} [CONFIRM: ...] markers are still in the text. Answer them, or add --allow-placeholders on a development store.`);
  process.exit(4);
}
if (!STORE || !TOKEN) {
  console.error('Set STORE and SHOPIFY_ADMIN_API_ACCESS_TOKEN (run through scripts/setup/with-admin-token.sh).');
  process.exit(2);
}
if (!ALLOWED.split(',').map((s) => s.trim()).includes(STORE)) {
  console.error(`Refused: ${STORE} is not listed in SHOPIFY_ALLOWED_STORES.`);
  process.exit(3);
}

const client = createAdminClient({store: STORE, token: TOKEN, allowMutations: true});

const POLICY_MUTATION = `mutation SeedPolicy($shopPolicy: ShopPolicyInput!) {
  shopPolicyUpdate(shopPolicy: $shopPolicy) { shopPolicy { id type } userErrors { field message code } }
}`;
const PAGE_LOOKUP = `query SeedPageLookup($query: String!) { pages(first: 1, query: $query) { nodes { id handle } } }`;
const PAGE_CREATE = `mutation SeedPageCreate($page: PageCreateInput!) {
  pageCreate(page: $page) { page { id handle } userErrors { field message code } }
}`;
const PAGE_UPDATE = `mutation SeedPageUpdate($id: ID!, $page: PageUpdateInput!) {
  pageUpdate(id: $id, page: $page) { page { id handle } userErrors { field message code } }
}`;

async function writePolicy(document) {
  const result = await client.request(POLICY_MUTATION, {shopPolicy: {type: document.policyType, body: document.body}}, {operationName: 'SeedPolicy'});
  if (!result.ok) return result.error.message;
  const payload = readPayload(result.data, 'shopPolicyUpdate');
  return payload.ok ? null : payload.error.message;
}

async function writePage(document) {
  const found = await client.request(PAGE_LOOKUP, {query: `handle:${document.handle}`}, {operationName: 'SeedPageLookup'});
  if (!found.ok) return found.error.message;
  const existing = found.data.pages?.nodes?.find((node) => node.handle === document.handle);
  const result = existing
    ? await client.request(PAGE_UPDATE, {id: existing.id, page: {title: document.title, body: document.body}}, {operationName: 'SeedPageUpdate'})
    : await client.request(PAGE_CREATE, {page: {title: document.title, handle: document.handle, body: document.body, isPublished: true}}, {operationName: 'SeedPageCreate'});
  if (!result.ok) return result.error.message;
  const payload = readPayload(result.data, existing ? 'pageUpdate' : 'pageCreate');
  return payload.ok ? null : payload.error.message;
}

let failed = 0;
for (const document of documents) {
  const problem = document.kind === 'policy' ? await writePolicy(document) : await writePage(document);
  if (problem) {
    failed += 1;
    console.error(`FAILED ${document.file}: ${problem}`);
  } else {
    console.log(`ok ${document.file}`);
  }
}
console.log(`${documents.length - failed} of ${documents.length} documents written.`);
process.exitCode = failed > 0 ? 1 : 0;
