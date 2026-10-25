import {describe, expect, it} from 'vitest';
import {
  CHAT_CSP,
  chatCspHosts,
  NO_CHAT_CSP,
  type ChatCsp,
} from '~/lib/chat/hosts';
import {buildReportOnlyCsp, enforcedCspExtras} from '~/lib/security-headers';

// REQ-ANL-004, T-10: chat hosts enter both policies only for a configured provider, together, and nothing changes
// otherwise. No real provider is approved, so the table is empty; the plumbing is proved with a synthetic provider.

const NONCE = 'abcdefgh12345678';
const base = {nonce: NONCE, development: false};

const SYNTHETIC: ChatCsp = {
  script: ['https://chat.vendor.example'],
  img: ['https://img.vendor.example'],
  connect: ['https://api.vendor.example'],
  frame: ['https://frame.vendor.example'],
};

function directive(policy: string | null, name: string): string[] {
  const line = (policy ?? '')
    .split('; ')
    .find((part) => part.startsWith(`${name} `));
  return line ? line.split(' ').slice(1) : [];
}

describe('REQ-ANL-004 chat CSP: nothing by default', () => {
  it('no approved provider has a host: the table is empty and every id gives none', () => {
    expect(Object.keys(CHAT_CSP)).toEqual([]);
    expect(chatCspHosts(null)).toBe(NO_CHAT_CSP);
    expect(chatCspHosts('fake')).toBe(NO_CHAT_CSP);
  });

  it('with no chat hosts both policies are byte-for-byte what they were', () => {
    expect(buildReportOnlyCsp({...base, chat: NO_CHAT_CSP})).toBe(
      buildReportOnlyCsp(base),
    );
    expect(enforcedCspExtras(undefined, NO_CHAT_CSP)).toEqual({});
    expect(enforcedCspExtras({ga4: true}, NO_CHAT_CSP)).toEqual(
      enforcedCspExtras({ga4: true}),
    );
    expect(directive(buildReportOnlyCsp(base), 'frame-src')).toEqual([
      "'none'",
    ]);
  });
});

describe('REQ-ANL-004 chat CSP: a configured provider (synthetic) is in both policies', () => {
  const report = buildReportOnlyCsp({...base, chat: SYNTHETIC});
  const enforced = enforcedCspExtras(undefined, SYNTHETIC);

  it('report-only names each host in its own directive and only there', () => {
    expect(directive(report, 'script-src')).toContain(
      'https://chat.vendor.example',
    );
    expect(directive(report, 'img-src')).toContain(
      'https://img.vendor.example',
    );
    expect(directive(report, 'connect-src')).toContain(
      'https://api.vendor.example',
    );
    // The same base sources as the enforced policy plus the chat window's origin (n3: no policy refuses what the other allows).
    expect(directive(report, 'frame-src')).toEqual([
      "'self'",
      'https://cdn.shopify.com',
      'https://shopify.com',
      'https://frame.vendor.example',
    ]);
    expect(directive(report, 'frame-src')).toEqual(enforced.frameSrc);
    expect(directive(report, 'default-src')).toEqual(["'self'"]);
    expect(report).not.toContain('unsafe-eval');
    expect(report).not.toMatch(/(?:^|[ ;])\*(?:[ ;]|$)/);
  });

  it('enforced extras carry the same hosts, with the Shopify fallbacks repeated', () => {
    expect(enforced.scriptSrc).toEqual([
      "'self'",
      'https://cdn.shopify.com',
      'https://shopify.com',
      'https://chat.vendor.example',
    ]);
    expect(enforced.imgSrc).toContain('https://img.vendor.example');
    expect(enforced.imgSrc).toContain('https://cdn.shopify.com');
    expect(enforced.connectSrc).toEqual(['https://api.vendor.example']);
    expect(enforced.frameSrc).toContain('https://frame.vendor.example');
  });

  it('parity: every host in the report-only policy is in the enforced extras', () => {
    const inEnforced = new Set(
      [
        ...(enforced.scriptSrc ?? []),
        ...(enforced.imgSrc ?? []),
        ...(enforced.connectSrc ?? []),
        ...(enforced.frameSrc ?? []),
      ].filter((source) => source.startsWith('https://')),
    );
    for (const host of Object.values(SYNTHETIC).flat()) {
      expect(inEnforced.has(host)).toBe(true);
    }
  });

  it('merges with analytics hosts instead of replacing them', () => {
    const both = enforcedCspExtras({ga4: true}, SYNTHETIC);
    expect(both.scriptSrc).toContain('https://www.googletagmanager.com');
    expect(both.scriptSrc).toContain('https://chat.vendor.example');
    expect(both.connectSrc).toContain('https://api.vendor.example');
    const reportBoth = buildReportOnlyCsp({
      ...base,
      analytics: {ga4: true},
      chat: SYNTHETIC,
    });
    expect(directive(reportBoth, 'script-src')).toEqual(
      expect.arrayContaining([
        'https://www.googletagmanager.com',
        'https://chat.vendor.example',
      ]),
    );
  });

  it('a provider with an image host only still repeats the Shopify image sources', () => {
    const imgOnly = enforcedCspExtras(undefined, {
      ...NO_CHAT_CSP,
      img: ['https://i.vendor.example'],
    });
    expect(imgOnly.scriptSrc).toBeUndefined();
    expect(imgOnly.imgSrc).toEqual([
      "'self'",
      'https://cdn.shopify.com',
      'https://shopify.com',
      'https://i.vendor.example',
    ]);
  });
});
