import {describe, expect, it} from 'vitest';
import {GA4_CSP, META_CSP} from '~/lib/analytics/hosts';
import {
  analyticsCspHosts,
  buildReportOnlyCsp,
  enforcedCspExtras,
} from '~/lib/security-headers';

// P7-01, T-10: a provider's hosts enter the policy only when its id is set; with none set the policy is unchanged.

const BASE = {
  nonce: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  storeDomain: 'shop.example.com',
  checkoutDomain: 'checkout.example.com',
  development: false,
} as const;

function directive(policy: string, name: string): string[] {
  const found = policy
    .split('; ')
    .map((part) => part.split(' '))
    .find(([directiveName]) => directiveName === name);
  return found ? found.slice(1) : [];
}

describe('report-only policy and analytics hosts', () => {
  const without = buildReportOnlyCsp(BASE) ?? '';

  it('with no id set the policy is byte-for-byte what it was (no hole)', () => {
    expect(buildReportOnlyCsp({...BASE, analytics: undefined})).toBe(without);
    expect(buildReportOnlyCsp({...BASE, analytics: {}})).toBe(without);
    expect(
      buildReportOnlyCsp({...BASE, analytics: {ga4: false, meta: false}}),
    ).toBe(without);
    expect(without).not.toMatch(/google|facebook/);
  });

  it('GA4 adds Google hosts to script, image and connect sources only', () => {
    const policy = buildReportOnlyCsp({...BASE, analytics: {ga4: true}}) ?? '';
    expect(directive(policy, 'script-src')).toContain(
      'https://www.googletagmanager.com',
    );
    expect(directive(policy, 'img-src')).toEqual(
      expect.arrayContaining([...GA4_CSP.img]),
    );
    expect(directive(policy, 'connect-src')).toEqual(
      expect.arrayContaining([...GA4_CSP.connect]),
    );
    expect(policy).not.toContain('facebook');
    for (const name of [
      'default-src',
      'style-src',
      'frame-src',
      'object-src',
      'form-action',
      'font-src',
    ]) {
      expect(directive(policy, name)).toEqual(directive(without, name));
    }
  });

  it('Meta adds Meta hosts only', () => {
    const policy = buildReportOnlyCsp({...BASE, analytics: {meta: true}}) ?? '';
    expect(directive(policy, 'script-src')).toContain(
      'https://connect.facebook.net',
    );
    expect(directive(policy, 'img-src')).toContain('https://www.facebook.com');
    expect(directive(policy, 'connect-src')).toEqual(
      expect.arrayContaining([...META_CSP.connect]),
    );
    expect(policy).not.toMatch(/google/);
  });

  it('never loosens the script policy: no unsafe-inline, no unsafe-eval, no bare wildcard, nonce kept', () => {
    const policy =
      buildReportOnlyCsp({...BASE, analytics: {ga4: true, meta: true}}) ?? '';
    const scripts = directive(policy, 'script-src');
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts).not.toContain('*');
    expect(scripts).toContain(`'nonce-${BASE.nonce}'`);
    expect(scripts.every((source) => !source.includes('*'))).toBe(true);
    expect(directive(policy, 'script-src-attr')).toEqual(["'none'"]);
  });

  it('wildcards appear only for the two Google analytics domains, in image and connect sources (owner approval pending)', () => {
    const policy =
      buildReportOnlyCsp({...BASE, analytics: {ga4: true, meta: true}}) ?? '';
    const wild = (policy.match(/https:\/\/\*\.[^\s;]+/g) ?? []).sort();
    expect(new Set(wild)).toEqual(
      new Set([
        'https://*.google-analytics.com',
        'https://*.analytics.google.com',
      ]),
    );
    for (const name of ['script-src', 'default-src', 'frame-src']) {
      expect(directive(policy, name).join(' ')).not.toContain('*');
    }
  });

  it('no longer allows all of google.com for connections (review L-1): only the named analytics hosts', () => {
    const policy = buildReportOnlyCsp({...BASE, analytics: {ga4: true}}) ?? '';
    const connect = directive(policy, 'connect-src');
    expect(connect).not.toContain('https://*.google.com');
    expect(connect).toEqual(
      expect.arrayContaining([
        'https://www.google.com',
        'https://analytics.google.com',
        'https://*.analytics.google.com',
      ]),
    );
    expect(
      (policy.match(/https?:\/\/[^\s;]*google\.com/g) ?? []).sort(),
    ).toEqual(
      [
        'https://*.analytics.google.com',
        'https://analytics.google.com',
        'https://www.google.com',
      ].sort(),
    );
  });
});

describe('enforced policy extras for Hydrogen', () => {
  it('are empty with no provider, so the enforced policy is untouched', () => {
    expect(enforcedCspExtras(undefined)).toEqual({});
    expect(enforcedCspExtras({})).toEqual({});
    expect(enforcedCspExtras({ga4: false, meta: false})).toEqual({});
  });

  it('repeat the Shopify fallback sources when script-src and img-src are named, and add the provider hosts', () => {
    const extras = enforcedCspExtras({ga4: true});
    expect(extras.scriptSrc).toEqual([
      "'self'",
      'https://cdn.shopify.com',
      'https://shopify.com',
      'https://www.googletagmanager.com',
    ]);
    expect(extras.imgSrc).toEqual(
      expect.arrayContaining([
        "'self'",
        'https://cdn.shopify.com',
        'https://shopify.com',
        ...GA4_CSP.img,
      ]),
    );
    expect(extras.connectSrc).toEqual([...GA4_CSP.connect]);
    expect(JSON.stringify(extras)).not.toMatch(/unsafe|nonce/);
  });

  it('combines both providers', () => {
    const hosts = analyticsCspHosts({ga4: true, meta: true});
    expect(hosts.script).toEqual([
      'https://www.googletagmanager.com',
      'https://connect.facebook.net',
    ]);
  });
});
