#!/usr/bin/env node
// Prints the exact Lighthouse CI command for the local production preview (P7-06, NFR-002). It runs nothing and
// installs nothing: `@lhci/cli` is not a project dependency (an ADR is needed to add it), so the command goes
// through a pinned `npx`. The URLs are passed as flags rather than kept in `lighthouserc.json` because two of
// them need a handle that exists in the store being measured; the config holds only the thresholds.
//
//   npm run perf:lighthouse -- --collection <handle> --product <handle> [--port 4900]
//
// Documentation: docs/testing/PERFORMANCE.md, "How to run".

import { EXIT_OK, EXIT_USAGE, isMainModule, parseFlags } from '../lib/cli.mjs';

export const LHCI_VERSION = '0.15.1';
export const DEFAULT_PORT = 4900;
// A Shopify handle: lower-case letters, digits and hyphens. Anything else is refused so that a value can never
// change the meaning of the printed shell command.
const HANDLE = /^[a-z0-9][a-z0-9-]{0,254}$/;

/**
 * @param {{ port: number, collection: string, product: string }} args
 * @returns {string[]} the URLs, in the order they are measured
 */
export function lighthouseUrls({ port, collection, product }) {
  const origin = `http://localhost:${port}`;
  return [`${origin}/`, `${origin}/collections/${collection}`, `${origin}/products/${product}`, `${origin}/cart`, `${origin}/quiz`, `${origin}/search`, `${origin}/compare`];
}

/**
 * @param {{ port: number, collection: string, product: string }} args
 * @returns {string}
 */
export function lighthouseCommand(args) {
  const urls = lighthouseUrls(args).map((url) => `  --collect.url=${url}`);
  // A trailing backslash continues the command on the next line in Git Bash and other POSIX shells.
  return [`npx -y @lhci/cli@${LHCI_VERSION} autorun --config=lighthouserc.json \\`, ...urls.map((line, index) => (index < urls.length - 1 ? `${line} \\` : line))].join('\n');
}

const USAGE = `Usage: npm run perf:lighthouse -- --product <handle> [--collection <handle>] [--port ${DEFAULT_PORT}]

Prints the Lighthouse CI command; it does not run it. --product is required (a handle that exists in the
store you are measuring). --collection defaults to "all".`;

/**
 * @param {readonly string[]} argv
 * @param {{ out?: (text: string) => void, err?: (text: string) => void }} [io]
 * @returns {number}
 */
export function main(argv, { out = (text) => console.log(text), err = (text) => console.error(text) } = {}) {
  const flags = parseFlags(argv, { product: { type: 'string' }, collection: { type: 'string' }, port: { type: 'string' }, help: { type: 'boolean' } });
  if (!flags.ok || flags.values.help) {
    err(flags.ok ? USAGE : `${flags.message}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const product = flags.values.product;
  const collection = flags.values.collection ?? 'all';
  const portText = flags.values.port ?? String(DEFAULT_PORT);
  if (typeof product !== 'string' || !HANDLE.test(product)) {
    err(`--product must be a handle (lower-case letters, digits, hyphens).\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (typeof collection !== 'string' || !HANDLE.test(collection)) {
    err(`--collection must be a handle (lower-case letters, digits, hyphens).\n${USAGE}`);
    return EXIT_USAGE;
  }
  const port = typeof portText === 'string' && /^[0-9]{2,5}$/.test(portText) ? Number(portText) : 0;
  if (port < 1024 || port > 65535) {
    err(`--port must be between 1024 and 65535.\n${USAGE}`);
    return EXIT_USAGE;
  }
  out(lighthouseCommand({ port, collection, product }));
  return EXIT_OK;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
