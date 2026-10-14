// Module resolution hooks that let plain Node (22.18 and later strip TypeScript types by default) import the storefront's
// pure Extend libraries, so the reconcile script uses exactly the code the webhook route uses instead of a second copy.
// Only the project alias `~/` (-> storefront/app/) and extensionless imports inside it are handled; nothing else changes.
// Type stripping erases types only: the imported modules must stay free of enums, namespaces and parameter properties
// (they are, and the tests in reconcile.test.mjs would fail loudly if one appeared).

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

/**
 * @param {string} specifier
 * @param {{ parentURL?: string }} context
 * @param {(specifier: string, context: unknown) => Promise<unknown>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('~/')) {
    const target = path.join(APP_ROOT, specifier.slice(2));
    const found = path.extname(target) ? target : withExtension(target);
    // The alias can never leave the app folder.
    if (found && path.resolve(found).startsWith(APP_ROOT + path.sep)) {
      return nextResolve(pathToFileURL(found).href, context);
    }
  }
  return nextResolve(specifier, context);
}
