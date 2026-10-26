// Generates the Storefront API and Customer Account API types from the `#graphql` documents in app/ (ADR-0012).
//
// Hydrogen 2026.10 dropped `shopify hydrogen codegen` (the CLI plugin is disabled by the package) and moved to gql.tada,
// where the types are inferred inside the editor and the compiler. This project keeps the document-pluck pipeline
// instead: 46 query call sites and the cart fragments already live as `#graphql` strings, and the generated files are a
// committed, reviewable contract. Only the schema source changed: the schemas that ship with @shopify/hydrogen 2026.10,
// which match the Storefront and Customer Account API version the client sends (2026-10).
//
// Run: `npm run codegen` (also the first step of `npm run build`). Output: storefrontapi.generated.d.ts and
// customer-accountapi.generated.d.ts. The documents are matched by the same globs as .graphqlrc.ts (kept for the editor).

import {generate} from '@graphql-codegen/cli';
import {getSchema, pluckConfig, preset} from '@shopify/hydrogen-codegen';
import {readFile, writeFile} from 'node:fs/promises';
import {format, resolveConfig} from 'prettier';

const STOREFRONT_OUTPUT = 'storefrontapi.generated.d.ts';
const CUSTOMER_OUTPUT = 'customer-accountapi.generated.d.ts';

/**
 * Replaces the template's `declare module '@shopify/hydrogen'` augmentation, which the 2026.10 package no longer reads, with
 * plain exports that app/lib/hydrogen/storefront.ts and customer-account.ts import to type `query` and `mutate`.
 */
const exportsOnly =
  (queriesName, mutationsName) =>
  ({queryType, mutationType}) =>
    `\nexport type ${queriesName} = ${queryType};\nexport type ${mutationsName} = ${mutationType};\n`;

const config = {
  cwd: process.cwd(),
  overwrite: true,
  silent: true,
  pluckConfig,
  generates: {
    [STOREFRONT_OUTPUT]: {
      preset,
      schema: getSchema('storefront'),
      documents: [
        './*.{ts,tsx,js,jsx}',
        './app/**/*.{ts,tsx,js,jsx}',
        '!./app/graphql/**/*.{ts,tsx,js,jsx}',
      ],
      presetConfig: {
        interfaceExtension: exportsOnly(
          'StorefrontQueries',
          'StorefrontMutations',
        ),
      },
    },
    [CUSTOMER_OUTPUT]: {
      preset,
      schema: getSchema('customer-account'),
      documents: ['./app/graphql/customer-account/*.{ts,tsx,js,jsx}'],
      presetConfig: {
        interfaceExtension: exportsOnly(
          'CustomerAccountQueries',
          'CustomerAccountMutations',
        ),
      },
    },
  },
};

async function formatOutput(file) {
  const source = await readFile(file, 'utf8');
  const options = (await resolveConfig(file)) ?? {};
  await writeFile(file, await format(source, {...options, filepath: file}));
}

try {
  await generate(config, true);
  await Promise.all([
    formatOutput(STOREFRONT_OUTPUT),
    formatOutput(CUSTOMER_OUTPUT),
  ]);
  console.warn(`codegen: wrote ${STOREFRONT_OUTPUT} and ${CUSTOMER_OUTPUT}`);
} catch (error) {
  // The message names the document and the field; it never holds a token.
  console.error(
    'codegen failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
