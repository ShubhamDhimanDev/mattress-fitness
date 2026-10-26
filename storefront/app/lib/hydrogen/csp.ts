// Content-Security-Policy with a per-response nonce. Ported from @shopify/hydrogen 2026.4.7 (MIT), which removed
// `createContentSecurityPolicy` in 2026.10 (ADR-0012). The directives are unchanged: this is the enforced policy that
// entry.server.tsx sends, next to the stricter report-only one (docs/security/SECURITY_HEADERS.md).

import {createElement, type ReactNode} from 'react';
import {NonceProvider} from './nonce';

type Sources = string[];

export type CspDirectives = {
  baseUri?: Sources;
  defaultSrc?: Sources;
  frameAncestors?: Sources;
  styleSrc?: Sources;
  connectSrc?: Sources;
  scriptSrc?: Sources;
  imgSrc?: Sources;
  frameSrc?: Sources;
};

type DirectiveName = keyof CspDirectives;

export type CspProps = CspDirectives & {
  shop?: {checkoutDomain?: string; storeDomain?: string};
};

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

const kebab = (name: string): string =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function build(directives: CspDirectives): string {
  return Object.entries(directives)
    .filter((entry): entry is [string, Sources] => Array.isArray(entry[1]))
    .map(([name, sources]) => [kebab(name), ...sources].join(' '))
    .join('; ');
}

/** Extra sources are appended to the defaults, except an extra of only `'none'`, which leaves the default alone. */
function addSources(current: Sources, extra: Sources): Sources {
  return extra.every((source) => source === "'none'")
    ? current
    : [...current, ...extra];
}

function createHeader(nonce: string, props: CspProps): string {
  const {shop, ...overrides} = props;
  const nonceSource = `'nonce-${nonce}'`;
  const styleSrc = ["'self'", "'unsafe-inline'", 'https://cdn.shopify.com'];
  const connectSrc = [
    "'self'",
    'https://cdn.shopify.com/',
    'https://monorail-edge.shopifysvc.com',
  ];
  if (shop?.checkoutDomain) connectSrc.push(`https://${shop.checkoutDomain}`);
  if (shop?.storeDomain) connectSrc.push(`https://${shop.storeDomain}`);
  const defaultSrc = [
    "'self'",
    nonceSource,
    'https://cdn.shopify.com',
    // The Customer Account API.
    'https://shopify.com',
  ];

  const defaults: CspDirectives = {
    baseUri: ["'self'"],
    defaultSrc,
    frameAncestors: ["'none'"],
    styleSrc,
    connectSrc,
  };
  if (import.meta.env.DEV) {
    defaults.styleSrc = [...styleSrc, 'http://localhost:*'];
    defaults.defaultSrc = [...defaultSrc, 'http://localhost:*'];
    defaults.connectSrc = [
      ...connectSrc,
      'http://localhost:*',
      // Hot module replacement.
      'ws://localhost:*',
      'ws://127.0.0.1:*',
      'ws://*.tryhydrogen.dev:*',
    ];
  }

  const combined: CspDirectives = {...defaults, ...overrides};
  for (const key of Object.keys(defaults) as DirectiveName[]) {
    const extra = overrides[key];
    const base = defaults[key];
    if (extra && base) combined[key] = addSources(base, extra);
  }

  // The nonce goes where scripts are decided: script-src when named, else the default-src fallback.
  const withoutNonce = (sources: Sources) =>
    sources.filter((source) => !source.startsWith("'nonce"));
  if (combined.scriptSrc) {
    combined.scriptSrc = [...withoutNonce(combined.scriptSrc), nonceSource];
  } else if (combined.defaultSrc) {
    combined.defaultSrc = [...withoutNonce(combined.defaultSrc), nonceSource];
  }
  return build(combined);
}

export function createContentSecurityPolicy(props: CspProps = {}) {
  const nonce = generateNonce();
  return {
    nonce,
    header: createHeader(nonce, props),
    NonceProvider: ({children}: {children?: ReactNode}) =>
      createElement(NonceProvider, {value: nonce}, children),
  };
}
