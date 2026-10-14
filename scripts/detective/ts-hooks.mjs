// Module resolution hooks that let plain Node (22.18 and later strip TypeScript types by default) import the storefront's
// pure libraries, so the detective report runs exactly the code the webhook runs instead of a second copy.
// Handled: the project alias `~/` (-> storefront/app/), and extensionless RELATIVE imports from a file inside
// storefront/app (the offer engine under app/lib/offers imports './addons' and the like). The extend loader next door
// (scripts/extend/ts-hooks.mjs) handles the alias only; the offer engine needs the relative case too, which is why this
// loader is a separate file. Nothing else changes, and the alias can never leave the app folder.
// Type stripping erases types only: the imported modules must stay free of enums, namespaces and parameter properties,
// and every type-only import must be `import type` (the tests in report.test.mjs fail loudly if one slips in).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../storefront/app');

/** @param {string} base @returns {string | null} */
function withExtension(base) {
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** @param {string} file */
function insideApp(file) {
  return path.resolve(file).startsWith(APP_ROOT + path.sep);
}

/**
 * @param {string} specifier
 * @param {{ parentURL?: string }} context
 * @param {(specifier: string, context: unknown) => Promise<unknown>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  /** @type {string | null} */
  let target = null;
  if (specifier.startsWith('~/')) {
    target = path.join(APP_ROOT, specifier.slice(2));
  } else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const parent = fileURLToPath(context.parentURL);
    if (insideApp(parent)) target = path.resolve(path.dirname(parent), specifier);
  }
  if (target !== null) {
    const found = path.extname(target) ? target : withExtension(target);
    if (found && insideApp(found)) return nextResolve(pathToFileURL(found).href, context);
  }
  return nextResolve(specifier, context);
}
