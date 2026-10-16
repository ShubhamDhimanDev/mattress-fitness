#!/usr/bin/env node
// Applies definitions.json to a store: metaobject definitions first, then product metafield definitions
// (P3A-02, REQ-CAT-005, REQ-LOC-002). Idempotent: existing definitions are left alone and any difference
// is reported, never silently changed. Dry run is the default. The one change made to an existing
// metaobject definition is ADDING a field the spec has and the store lacks (a definition created from an
// older spec, for example site_settings before support_phone existed); nothing is ever altered or deleted.
//
// Exit codes (also in USAGE): 0 the store is in sync, or --live applied everything; 1 a dry run that still has
// definitions to create or fields to add (it prints PENDING CHANGES), differences, or failures; 2 usage or file
// problem; 3 refused by the guard. --offline reads no store, so it claims nothing about one and exits 0 when the spec
// is valid.
//
//   node scripts/shopify/apply-definitions.mjs --offline            plan only, no network
//   node scripts/shopify/apply-definitions.mjs --store x.myshopify.com   dry run: reads the store
//   node scripts/shopify/apply-definitions.mjs --store x.myshopify.com --live
//
// Documentation (Admin GraphQL 2026-10, read 2026-10-12):
//  metafieldDefinitionCreate(definition: MetafieldDefinitionInput!)   .../mutations/metafieldDefinitionCreate
//    MetafieldDefinitionInput: name, namespace, key, type, ownerType, description, validations [{name,value}],
//    access (MetafieldAccessInput: storefront NONE | PUBLIC_READ), capabilities (smartCollectionCondition { enabled }).
//  metaobjectDefinitionCreate(definition: MetaobjectDefinitionCreateInput!)  scope write_metaobject_definitions
//    fields: type, name, description, displayNameKey, access { storefront: PUBLIC_READ }, fieldDefinitions
//    [{ key, name, description, type, required, validations }].
//  metaobjectDefinitionUpdate(id: ID!, definition: MetaobjectDefinitionUpdateInput!)  scope write_metaobject_definitions
//    (read 2026-10-15) definition.fieldDefinitions is a list of operations, exactly one of { create, update, delete }
//    each; create takes MetaobjectFieldDefinitionCreateInput { key!, type!, name, description, required (default
//    false), validations, capabilities }. resetFieldOrder defaults to false, so a created field is appended and
//    existing fields keep their order. This tool only ever sends `create` operations.
//  metaobjectDefinitionByType(type) scope read_metaobject_definitions; metafieldDefinitions(ownerType, namespace).
//  Validations: https://shopify.dev/docs/apps/build/custom-data/metafields/definitions/list-of-validation-options
//    choices (single_line_text_field only, value = JSON-encoded array), min/max, metaobject_definition_type,
//    file_type_options. UNVERIFIED(V-05): smartCollectionCondition eligibility per type, file_type_options value
//    format and the Storefront API behaviour of every field type are confirmed on the development store, not here.
//  The Admin API cannot configure Search and Discovery filters; that stays a manual checklist step (V-04).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EXIT_FAILED, EXIT_OK, EXIT_REFUSED, EXIT_USAGE, isMainModule, parseFlags, renderTable } from '../lib/cli.mjs';
import { ENV_API_VERSION, ENV_STORE_DOMAIN, checkLiveAllowed, checkStoreAllowed, readAdminToken } from '../lib/env.mjs';
import { createLogger } from '../lib/redact.mjs';
import { ADMIN_API_VERSION, connectionNodes, createAdminClient, isRecord, readPayload } from '../lib/shopify-admin.mjs';

export const DEFAULT_SPEC_PATH = fileURLToPath(new URL('./definitions.json', import.meta.url));

const KEY_PATTERN = /^[A-Za-z0-9_-]{2,64}$/;
const NAMESPACE_PATTERN = /^[A-Za-z0-9_-]{3,255}$/;
const TYPE_NAME_PATTERN = /^[a-z0-9_]{3,255}$/;
const OWNER_TYPES = Object.freeze(['PRODUCT', 'PRODUCTVARIANT', 'COLLECTION']);
const STOREFRONT_ACCESS = Object.freeze(['NONE', 'PUBLIC_READ']);

/**
 * @typedef {{ name: string, value: string | number | boolean | string[] }} SpecValidation
 * @typedef {{ key: string, name: string, type: string, required?: boolean, description?: string, validations?: SpecValidation[] }} SpecField
 * @typedef {{ type: string, name: string, description?: string, displayNameKey: string, storefrontAccess: string, fieldDefinitions: SpecField[] }} SpecMetaobject
 * @typedef {{ ownerType: string, namespace: string, key: string, name: string, type: string, description?: string, validations?: SpecValidation[], storefrontAccess: string, smartCollectionCondition?: boolean }} SpecMetafield
 * @typedef {{ specVersion: number, metaobjectDefinitions: SpecMetaobject[], metafieldDefinitions: SpecMetafield[] }} Spec
 */

/** @param {SpecValidation[] | undefined} validations */
export function encodeValidations(validations) {
  return (validations ?? []).map((validation) => ({
    name: validation.name,
    // The API takes every value as a string; lists are JSON-encoded (documented for choices).
    value: typeof validation.value === 'string' ? validation.value : Array.isArray(validation.value) ? JSON.stringify(validation.value) : String(validation.value),
  }));
}

/**
 * @param {SpecMetafield} definition
 * @returns {Record<string, unknown>} MetafieldDefinitionInput
 */
export function toMetafieldDefinitionInput(definition) {
  return {
    name: definition.name,
    namespace: definition.namespace,
    key: definition.key,
    type: definition.type,
    ownerType: definition.ownerType,
    ...(definition.description ? { description: definition.description } : {}),
    ...(definition.validations?.length ? { validations: encodeValidations(definition.validations) } : {}),
    access: { storefront: definition.storefrontAccess },
    ...(definition.smartCollectionCondition ? { capabilities: { smartCollectionCondition: { enabled: true } } } : {}),
  };
}

/**
 * @param {SpecMetaobject} definition
 * @returns {Record<string, unknown>} MetaobjectDefinitionCreateInput
 */
export function toMetaobjectDefinitionInput(definition) {
  return {
    type: definition.type,
    name: definition.name,
    ...(definition.description ? { description: definition.description } : {}),
    displayNameKey: definition.displayNameKey,
    access: { storefront: definition.storefrontAccess },
    fieldDefinitions: definition.fieldDefinitions.map(toFieldInput),
  };
}

/**
 * One field as the create input of both mutations (MetaobjectFieldDefinitionCreateInput).
 * @param {SpecField} field
 * @returns {Record<string, unknown>}
 */
export function toFieldInput(field) {
  return {
    key: field.key,
    name: field.name,
    type: field.type,
    required: field.required === true,
    ...(field.description ? { description: field.description } : {}),
    ...(field.validations?.length ? { validations: encodeValidations(field.validations) } : {}),
  };
}

/**
 * The update input that adds fields and does nothing else: only `create` operations, no name, access, display
 * name or field order change, no update or delete operation.
 * @param {SpecField[]} fields
 * @returns {Record<string, unknown>} MetaobjectDefinitionUpdateInput
 */
export function toAddFieldsInput(fields) {
  return { fieldDefinitions: fields.map((field) => ({ create: toFieldInput(field) })) };
}

/**
 * Structural checks so a typo in definitions.json fails here rather than halfway through a live run.
 * @param {unknown} spec
 * @returns {{ ok: true, spec: Spec } | { ok: false, errors: string[] }}
 */
export function validateSpec(spec) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(spec) || spec.specVersion !== 1 || !Array.isArray(spec.metaobjectDefinitions) || !Array.isArray(spec.metafieldDefinitions)) {
    return { ok: false, errors: ['The spec must be an object with specVersion 1, metaobjectDefinitions and metafieldDefinitions.'] };
  }
  const declaredTypes = new Set();
  for (const raw of spec.metaobjectDefinitions) {
    if (!isRecord(raw) || typeof raw.type !== 'string' || !TYPE_NAME_PATTERN.test(raw.type)) {
      errors.push('A metaobject definition has a missing or invalid type.');
      continue;
    }
    const label = `metaobject ${raw.type}`;
    if (declaredTypes.has(raw.type)) errors.push(`${label}: declared twice.`);
    if (typeof raw.name !== 'string' || raw.name === '') errors.push(`${label}: name is required.`);
    if (!STOREFRONT_ACCESS.includes(String(raw.storefrontAccess))) errors.push(`${label}: storefrontAccess must be NONE or PUBLIC_READ.`);
    const fields = Array.isArray(raw.fieldDefinitions) ? raw.fieldDefinitions : [];
    if (fields.length === 0) errors.push(`${label}: needs at least one field.`);
    const keys = new Set();
    for (const field of fields) {
      if (!isRecord(field) || typeof field.key !== 'string' || !KEY_PATTERN.test(field.key)) {
        errors.push(`${label}: a field has a missing or invalid key (2-64 letters, digits, - or _).`);
        continue;
      }
      if (keys.has(field.key)) errors.push(`${label}: field ${field.key} is declared twice.`);
      keys.add(field.key);
      if (typeof field.type !== 'string' || field.type === '') errors.push(`${label}.${field.key}: type is required.`);
      for (const validation of Array.isArray(field.validations) ? field.validations : []) {
        if (isRecord(validation) && validation.name === 'metaobject_definition_type' && !declaredTypes.has(validation.value)) {
          errors.push(`${label}.${field.key}: references metaobject type "${String(validation.value)}" that is not declared before it.`);
        }
      }
    }
    if (typeof raw.displayNameKey !== 'string' || !keys.has(raw.displayNameKey)) errors.push(`${label}: displayNameKey must name one of its fields.`);
    declaredTypes.add(raw.type);
  }
  const seen = new Set();
  for (const raw of spec.metafieldDefinitions) {
    if (!isRecord(raw)) {
      errors.push('A metafield definition is not an object.');
      continue;
    }
    const label = `metafield ${String(raw.ownerType)}:${String(raw.namespace)}.${String(raw.key)}`;
    if (!OWNER_TYPES.includes(String(raw.ownerType))) errors.push(`${label}: ownerType must be one of ${OWNER_TYPES.join(', ')}.`);
    if (typeof raw.namespace !== 'string' || !NAMESPACE_PATTERN.test(raw.namespace)) errors.push(`${label}: invalid namespace.`);
    if (typeof raw.key !== 'string' || !KEY_PATTERN.test(raw.key)) errors.push(`${label}: invalid key.`);
    if (typeof raw.type !== 'string' || raw.type === '') errors.push(`${label}: type is required.`);
    if (typeof raw.name !== 'string' || raw.name === '') errors.push(`${label}: name is required.`);
    if (!STOREFRONT_ACCESS.includes(String(raw.storefrontAccess))) errors.push(`${label}: storefrontAccess must be NONE or PUBLIC_READ.`);
    if (seen.has(label)) errors.push(`${label}: declared twice.`);
    seen.add(label);
    for (const validation of Array.isArray(raw.validations) ? raw.validations : []) {
      if (isRecord(validation) && validation.name === 'metaobject_definition_type' && !declaredTypes.has(validation.value)) {
        errors.push(`${label}: references metaobject type "${String(validation.value)}" that the spec does not declare.`);
      }
      if (isRecord(validation) && validation.name === 'choices' && String(raw.type) !== 'single_line_text_field') {
        errors.push(`${label}: Shopify supports the choices validation only on single_line_text_field.`);
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, spec: /** @type {Spec} */ (/** @type {unknown} */ (spec)) };
}

// ---- reading and diffing -------------------------------------------------------------------------

const EXISTING_METAFIELDS = `query ExistingMetafieldDefinitions($ownerType: MetafieldOwnerType!, $namespace: String!) {
  metafieldDefinitions(ownerType: $ownerType, namespace: $namespace, first: 100) {
    nodes {
      id name namespace key description
      type { name }
      validations { name value }
      access { storefront }
      capabilities { smartCollectionCondition { enabled } }
    }
  }
}`;

const EXISTING_METAOBJECT = `query ExistingMetaobjectDefinition($type: String!) {
  metaobjectDefinitionByType(type: $type) {
    id type name description displayNameKey
    access { storefront }
    fieldDefinitions { key name description required type { name } validations { name value } }
  }
}`;

const UPDATE_METAOBJECT = `mutation AddMetaobjectDefinitionFields($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
  metaobjectDefinitionUpdate(id: $id, definition: $definition) { metaobjectDefinition { id type } userErrors { field message code } }
}`;

const METAOBJECT_DEFINITION_ID = /^gid:\/\/shopify\/MetaobjectDefinition\/[0-9]+$/;

const CREATE_METAFIELD = `mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) { createdDefinition { id namespace key } userErrors { field message code } }
}`;

const CREATE_METAOBJECT = `mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
  metaobjectDefinitionCreate(definition: $definition) { metaobjectDefinition { id type } userErrors { field message code } }
}`;

/** Order-insensitive, whitespace-insensitive form of a validation value (JSON arrays are canonicalised). */
function normaliseValidationValue(/** @type {string} */ value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? JSON.stringify(parsed.map(String)) : JSON.stringify(parsed);
  } catch {
    return value;
  }
}

/**
 * UNVERIFIED(V-05): the spec names the target by type, but Shopify may hand back the definition id.
 * Both mean "points at a metaobject definition", so only the presence is compared.
 * @param {{ name: string, value: string | null }[]} validations
 */
function validationMap(validations) {
  return new Map(
    validations.map((validation) =>
      validation.name.startsWith('metaobject_definition') ? ['metaobject_definition', 'reference'] : [validation.name, normaliseValidationValue(validation.value ?? '')],
    ),
  );
}

/**
 * @param {unknown} raw
 * @returns {{ name: string, value: string | null }[]}
 */
function readValidations(raw) {
  return Array.isArray(raw) ? raw.filter(isRecord).map((item) => ({ name: String(item.name), value: typeof item.value === 'string' ? item.value : null })) : [];
}

/**
 * @param {{ name: string, value: string | null }[]} desired
 * @param {{ name: string, value: string | null }[]} actual
 * @param {string} label
 * @returns {string[]}
 */
function diffValidations(desired, actual, label) {
  const want = validationMap(desired);
  const have = validationMap(actual);
  const out = [];
  for (const [name, value] of want) {
    if (!have.has(name)) out.push(`${label}: validation ${name} is missing in Shopify`);
    else if (have.get(name) !== value) out.push(`${label}: validation ${name} differs (Shopify ${have.get(name)}, spec ${value})`);
  }
  for (const name of have.keys()) if (!want.has(name)) out.push(`${label}: Shopify has an extra validation ${name}`);
  return out;
}

/**
 * @param {SpecMetafield} definition
 * @param {Record<string, unknown>} actual a metafieldDefinitions node
 * @returns {string[]}
 */
export function diffMetafieldDefinition(definition, actual) {
  const out = [];
  const typeName = isRecord(actual.type) ? actual.type.name : null;
  if (typeName !== definition.type) out.push(`type is ${String(typeName)} in Shopify, ${definition.type} in the spec (a type cannot be changed in place)`);
  if (actual.name !== definition.name) out.push(`name is "${String(actual.name)}" in Shopify, "${definition.name}" in the spec`);
  const storefront = isRecord(actual.access) ? actual.access.storefront : null;
  if (storefront !== definition.storefrontAccess) out.push(`Storefront API access is ${String(storefront)} in Shopify, ${definition.storefrontAccess} in the spec`);
  const capabilities = isRecord(actual.capabilities) ? actual.capabilities : {};
  const smart = isRecord(capabilities.smartCollectionCondition) ? capabilities.smartCollectionCondition.enabled === true : false;
  if (smart !== (definition.smartCollectionCondition === true)) out.push(`smart collection condition is ${smart ? 'on' : 'off'} in Shopify, ${definition.smartCollectionCondition ? 'on' : 'off'} in the spec`);
  out.push(...diffValidations(readValidations(encodeValidations(definition.validations)), readValidations(actual.validations), 'validations'));
  return out;
}

/**
 * @param {SpecMetaobject} definition
 * @param {Record<string, unknown>} actual a metaobjectDefinitionByType result
 * @returns {string[]}
 */
export function diffMetaobjectDefinition(definition, actual) {
  const out = [];
  if (actual.name !== definition.name) out.push(`name is "${String(actual.name)}" in Shopify, "${definition.name}" in the spec`);
  if (actual.displayNameKey !== definition.displayNameKey) out.push(`display name field is ${String(actual.displayNameKey)} in Shopify, ${definition.displayNameKey} in the spec`);
  const storefront = isRecord(actual.access) ? actual.access.storefront : null;
  if (storefront !== definition.storefrontAccess) out.push(`Storefront API access is ${String(storefront)} in Shopify, ${definition.storefrontAccess} in the spec`);
  const actualFields = new Map((Array.isArray(actual.fieldDefinitions) ? actual.fieldDefinitions : []).filter(isRecord).map((field) => [String(field.key), field]));
  for (const field of definition.fieldDefinitions) {
    const have = actualFields.get(field.key);
    if (!have) {
      out.push(`field ${field.key} is missing in Shopify`);
      continue;
    }
    const typeName = isRecord(have.type) ? have.type.name : null;
    if (typeName !== field.type) out.push(`field ${field.key}: type is ${String(typeName)} in Shopify, ${field.type} in the spec`);
    if ((have.required === true) !== (field.required === true)) out.push(`field ${field.key}: required is ${String(have.required === true)} in Shopify, ${String(field.required === true)} in the spec`);
    out.push(...diffValidations(readValidations(encodeValidations(field.validations)), readValidations(have.validations), `field ${field.key}`));
  }
  const wanted = new Set(definition.fieldDefinitions.map((field) => field.key));
  for (const key of actualFields.keys()) if (!wanted.has(key)) out.push(`Shopify has an extra field ${key}`);
  return out;
}

/**
 * Splits the spec fields the store lacks from every other difference. Missing fields are safe to add; the rest
 * is reported only.
 * @param {SpecMetaobject} definition
 * @param {Record<string, unknown>} actual a metaobjectDefinitionByType result
 * @returns {{ missing: SpecField[], diffs: string[] }}
 */
export function splitMissingFields(definition, actual) {
  const have = new Set((Array.isArray(actual.fieldDefinitions) ? actual.fieldDefinitions : []).filter(isRecord).map((field) => String(field.key)));
  const missing = definition.fieldDefinitions.filter((field) => !have.has(field.key));
  const missingLines = new Set(missing.map((field) => `field ${field.key} is missing in Shopify`));
  return { missing, diffs: diffMetaobjectDefinition(definition, actual).filter((line) => !missingLines.has(line)) };
}

/**
 * `add-fields`: the definition exists and only lacks fields the spec has; live, they are added.
 * @typedef {{ kind: 'metaobject' | 'metafield', label: string, action: 'create' | 'exists' | 'differs' | 'add-fields', diffs: string[], input: Record<string, unknown>, existingId?: string, addFields?: SpecField[] }} DefinitionPlanItem
 */

/**
 * Plan: what exists, what would be created, what differs. `client` null plans against an empty store.
 * @param {{ spec: Spec, client: import('../lib/shopify-admin.mjs').AdminClient | null }} args
 * @returns {Promise<{ ok: true, items: DefinitionPlanItem[] } | { ok: false, message: string }>}
 */
export async function planDefinitions({ spec, client }) {
  /** @type {DefinitionPlanItem[]} */
  const items = [];
  for (const definition of spec.metaobjectDefinitions) {
    const input = toMetaobjectDefinitionInput(definition);
    let existing = null;
    if (client) {
      const result = await client.request(EXISTING_METAOBJECT, { type: definition.type }, { operationName: 'ExistingMetaobjectDefinition', estimatedCost: 20 });
      if (!result.ok) return { ok: false, message: `Reading metaobject ${definition.type}: ${result.error.message}` };
      existing = isRecord(result.data.metaobjectDefinitionByType) ? result.data.metaobjectDefinitionByType : null;
    }
    if (!existing) {
      items.push({ kind: 'metaobject', label: definition.type, action: 'create', diffs: [], input });
      continue;
    }
    const { missing, diffs } = splitMissingFields(definition, existing);
    // Only a well-formed definition id is sent back to Shopify; anything else is reported, not changed.
    const existingId = typeof existing.id === 'string' && METAOBJECT_DEFINITION_ID.test(existing.id) ? existing.id : null;
    const addable = existingId !== null && missing.length > 0;
    const unaddable = !addable ? missing.map((field) => `field ${field.key} is missing in Shopify`) : [];
    const allDiffs = [...unaddable, ...diffs];
    const action = allDiffs.length > 0 ? 'differs' : addable ? 'add-fields' : 'exists';
    items.push({ kind: 'metaobject', label: definition.type, action, diffs: allDiffs, input, ...(addable ? { existingId, addFields: missing } : {}) });
  }
  /** @type {Map<string, Record<string, unknown>[]>} */
  const existingByScope = new Map();
  for (const definition of spec.metafieldDefinitions) {
    const scope = `${definition.ownerType}:${definition.namespace}`;
    if (client && !existingByScope.has(scope)) {
      const result = await client.request(EXISTING_METAFIELDS, { ownerType: definition.ownerType, namespace: definition.namespace }, { operationName: 'ExistingMetafieldDefinitions', estimatedCost: 50 });
      if (!result.ok) return { ok: false, message: `Reading ${scope} metafield definitions: ${result.error.message}` };
      existingByScope.set(scope, isRecord(result.data.metafieldDefinitions) ? connectionNodes(result.data.metafieldDefinitions) : []);
    }
    const existing = (existingByScope.get(scope) ?? []).find((node) => node.key === definition.key) ?? null;
    const diffs = existing ? diffMetafieldDefinition(definition, existing) : [];
    items.push({ kind: 'metafield', label: `${definition.ownerType.toLowerCase()} ${definition.namespace}.${definition.key}`, action: existing ? (diffs.length > 0 ? 'differs' : 'exists') : 'create', diffs, input: toMetafieldDefinitionInput(definition) });
  }
  return { ok: true, items };
}

/**
 * Creates what is missing and adds missing fields to existing metaobject definitions. A failure on one
 * definition does not stop the others (re-running is safe). Existing fields are never touched.
 * @param {{ items: DefinitionPlanItem[], client: import('../lib/shopify-admin.mjs').AdminClient }} args
 * @returns {Promise<{ created: string[], extended: string[], failed: { label: string, message: string }[] }>}
 */
export async function applyDefinitions({ items, client }) {
  /** @type {string[]} */
  const created = [];
  /** @type {string[]} */
  const extended = [];
  /** @type {{ label: string, message: string }[]} */
  const failed = [];
  for (const item of items) {
    if (item.existingId && item.addFields && item.addFields.length > 0) {
      const result = await client.request(UPDATE_METAOBJECT, { id: item.existingId, definition: toAddFieldsInput(item.addFields) }, { operationName: 'AddMetaobjectDefinitionFields', estimatedCost: 20 });
      if (!result.ok) {
        failed.push({ label: item.label, message: result.error.message });
        if (result.error.kind === 'auth' || result.error.kind === 'not_found') break;
        continue;
      }
      const payload = readPayload(result.data, 'metaobjectDefinitionUpdate');
      if (payload.ok) extended.push(item.label);
      else failed.push({ label: item.label, message: payload.error.message });
      continue;
    }
    if (item.action !== 'create') continue;
    const isMetaobject = item.kind === 'metaobject';
    const result = await client.request(isMetaobject ? CREATE_METAOBJECT : CREATE_METAFIELD, { definition: item.input }, { operationName: isMetaobject ? 'CreateMetaobjectDefinition' : 'CreateMetafieldDefinition', estimatedCost: 20 });
    if (!result.ok) {
      failed.push({ label: item.label, message: result.error.message });
      if (result.error.kind === 'auth' || result.error.kind === 'not_found') break;
      continue;
    }
    const payload = readPayload(result.data, isMetaobject ? 'metaobjectDefinitionCreate' : 'metafieldDefinitionCreate');
    if (payload.ok) created.push(item.label);
    else failed.push({ label: item.label, message: payload.error.message });
  }
  return { created, extended, failed };
}

// ---- CLI -----------------------------------------------------------------------------------------

const USAGE = `Usage: node scripts/shopify/apply-definitions.mjs [options]

  --offline        plan against an empty store; no network, no credentials
  --store <domain> <name>.myshopify.com (default: $${ENV_STORE_DOMAIN})
  --spec <file>    definitions file (default scripts/shopify/definitions.json)
  --live           CREATE the missing definitions and ADD fields the spec has to existing metaobject
                   definitions (nothing is altered or deleted). Default is a dry run. Needs SHOPIFY_ALLOWED_STORES.
Exit code: 0 in sync (or everything applied by --live); 1 a dry run with changes still pending (it prints
           PENDING CHANGES), differences or failures; 2 usage or file problem; 3 refused by the guard.
           --offline reads no store and exits 0 when the spec is valid.`;

/**
 * @param {readonly string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ out?: (text: string) => void, err?: (text: string) => void, fetch?: typeof fetch, clock?: import('../lib/shopify-admin.mjs').Clock, maxAttempts?: number }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, env, { out = (text) => console.log(text), err = (text) => console.error(text), fetch: doFetch = globalThis.fetch, clock, maxAttempts } = {}) {
  const flags = parseFlags(argv, { offline: { type: 'boolean' }, store: { type: 'string' }, spec: { type: 'string' }, live: { type: 'boolean' }, help: { type: 'boolean' } });
  if (!flags.ok || flags.values.help) {
    err(flags.ok ? USAGE : `${flags.message}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const live = flags.values.live === true;
  const offline = flags.values.offline === true;
  if (live && offline) {
    err('--live and --offline cannot be combined.');
    return EXIT_USAGE;
  }
  const store = typeof flags.values.store === 'string' ? flags.values.store : env[ENV_STORE_DOMAIN];
  /** @type {import('../lib/shopify-admin.mjs').AdminClient | null} */
  let client = null;
  if (!offline) {
    const guard = live ? checkLiveAllowed({ live, store, env }) : checkStoreAllowed({ store, env });
    if (!guard.ok) {
      err(`Refused: ${guard.message}`);
      return EXIT_REFUSED;
    }
    const token = readAdminToken(env);
    if (!token.ok) {
      err(`Refused: ${token.message}`);
      return EXIT_REFUSED;
    }
    const logger = createLogger({ write: err, secrets: [token.token] });
    client = createAdminClient({ store: guard.store, token: token.token, apiVersion: env[ENV_API_VERSION] ?? ADMIN_API_VERSION, allowMutations: live, logger, fetch: doFetch, ...(clock ? { clock } : {}), ...(maxAttempts ? { maxAttempts } : {}) });
  }

  let spec;
  try {
    const text = await readFile(typeof flags.values.spec === 'string' ? flags.values.spec : DEFAULT_SPEC_PATH, 'utf8');
    const checked = validateSpec(JSON.parse(text));
    if (!checked.ok) {
      err(`The definitions file is invalid:\n- ${checked.errors.join('\n- ')}`);
      return EXIT_USAGE;
    }
    spec = checked.spec;
  } catch (error) {
    err(`Could not read the definitions file: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  }

  const plan = await planDefinitions({ spec, client });
  if (!plan.ok) {
    err(plan.message);
    return EXIT_FAILED;
  }
  out(`${live ? 'LIVE RUN' : 'DRY RUN'}${offline ? ' (offline: planned against an empty store)' : ''}`);
  out(renderTable(['kind', 'definition', 'action', 'differences'], plan.items.map((item) => [item.kind, item.label, item.action.toUpperCase(), item.diffs.length])));
  for (const item of plan.items) for (const diff of item.diffs) out(`DIFF ${item.label}: ${diff}`);
  for (const item of plan.items) for (const field of item.addFields ?? []) out(`ADD ${item.label}: field ${field.key} (${field.type}) is missing in Shopify and would be added`);
  const counts = { create: 0, exists: 0, differs: 0, 'add-fields': 0 };
  for (const item of plan.items) counts[item.action] += 1;
  out(`Plan: ${counts.create} to create, ${counts.exists} already in sync, ${counts.differs} differ (reported, never changed by this tool).`);
  const adding = plan.items.reduce((sum, item) => sum + (item.addFields?.length ?? 0), 0);
  if (adding > 0) out(`${adding} missing field(s) in ${counts['add-fields'] + plan.items.filter((item) => item.action === 'differs' && item.addFields).length} existing metaobject definition(s) would be added (existing fields are never changed or removed).`);

  // A dry run that still has something to create or add is not "in sync": it exits 1 so a script or a person reading
  // only the exit code cannot take it for a clean store. --offline plans against an empty store by design and says so.
  const pendingCreates = counts.create;
  const pending = !live && !offline && (pendingCreates > 0 || adding > 0);
  if (offline) out('OFFLINE: no store was read, so this plan says nothing about the state of any store; the exit code only reports that the spec is valid.');
  if (pending) {
    out(`PENDING CHANGES: ${pendingCreates} definition(s) to create and ${adding} field(s) to add. This was a dry run and wrote nothing; run again with --live to apply them.`);
  }

  let failures = 0;
  if (live && client) {
    const result = await applyDefinitions({ items: plan.items, client });
    out(`Created ${result.created.length} definition(s).`);
    if (adding > 0) out(`Added missing fields to ${result.extended.length} existing definition(s).`);
    for (const failure of result.failed) err(`FAILED ${failure.label}: ${failure.message}`);
    failures = result.failed.length;
  }
  return counts.differs > 0 || failures > 0 || pending ? EXIT_FAILED : EXIT_OK;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
