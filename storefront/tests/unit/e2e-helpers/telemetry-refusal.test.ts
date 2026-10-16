import {describe, expect, it} from 'vitest';
import {
  BLOCKED_TELEMETRY_HOST,
  blockedUrlOf,
  isBlockedTelemetryRefusal,
} from '../../e2e/helpers/telemetry-refusal';

// K-L7 / T-10 / DEC-045: the e2e console filter ignores one expected CSP refusal and nothing else, so a real CSP
// violation cannot hide behind it. The messages are Chromium's wording, with the host the helper expects.

const HOST = BLOCKED_TELEMETRY_HOST;
const DIRECTIVE = `because it violates the following Content Security Policy directive: "connect-src 'self' https://cdn.shopify.com https://monorail-edge.shopifysvc.com".`;
const DOCUMENT = `because it violates the document's Content Security Policy.`;

describe('isBlockedTelemetryRefusal (K-L7)', () => {
  it.each([
    [`Refused to connect to 'https://${HOST}/v1/metrics' ${DIRECTIVE}`],
    [`Refused to connect to 'https://${HOST}/v1/metrics' ${DOCUMENT}`],
    [
      `Fetch API cannot load https://${HOST}/v1/metrics. Refused to connect to 'https://${HOST}/v1/metrics' ${DOCUMENT}`,
    ],
    [
      `[Report Only] Refused to connect to 'https://${HOST}/v1/traces' ${DIRECTIVE}`,
    ],
    [`Refused to load the script 'https://${HOST}/x.js' ${DIRECTIVE}`],
    [
      `Fetch API cannot load https://${HOST}/v1/metrics. Refused to connect ${DOCUMENT}`,
    ],
    [
      `Refused to connect to 'https://${HOST.toUpperCase()}/v1/metrics' ${DOCUMENT}`,
    ],
  ])('ignores the expected refusal: %s', (text) => {
    expect(isBlockedTelemetryRefusal(text)).toBe(true);
  });

  it.each([
    // The old substring rule let all of these through.
    [
      `Refused to connect to 'https://${HOST}.attacker.example/v1' ${DIRECTIVE}`,
    ],
    [`Refused to connect to 'https://evil.example/?next=${HOST}' ${DIRECTIVE}`],
    [`Refused to connect to 'https://evil.example/${HOST}' ${DIRECTIVE}`],
    [`Refused to connect to 'https://${HOST}@evil.example/' ${DIRECTIVE}`],
    [`Refused to connect to 'https://evil.example#${HOST}' ${DIRECTIVE}`],
    [`Refused to connect to 'https://x-${HOST}/v1' ${DIRECTIVE}`],
    [`Refused to connect to 'https://sub.${HOST}/v1' ${DIRECTIVE}`],
    [`Refused to connect to 'http://${HOST}/v1' ${DIRECTIVE}`],
    // The expected host only in the policy text, while another URL is blocked.
    [
      `Refused to connect to 'https://evil.example/v1' because it violates the following Content Security Policy directive: "connect-src https://${HOST}".`,
    ],
    // A different host of the same vendor is a real finding.
    [
      `Refused to connect to 'https://monorail-edge.shopifysvc.com/v1/produce' ${DIRECTIVE}`,
    ],
    // Not a CSP refusal at all.
    [`Failed to load resource: https://${HOST}/v1/metrics net::ERR_FAILED`],
    [`TypeError: fetch failed for https://${HOST}/v1/metrics`],
    [
      `Refused to connect to 'https://${HOST}/v1/metrics' because of something else`,
    ],
    // Names no blocked URL.
    [`${HOST} violates the document's Content Security Policy`],
    [`Refused to connect to '' ${DOCUMENT}`],
    [`Refused to connect to 'not a url at all' ${DOCUMENT}`],
    [''],
  ])('does not ignore: %s', (text) => {
    expect(isBlockedTelemetryRefusal(text)).toBe(false);
  });

  it('is fast and total on hostile input', () => {
    const started = Date.now();
    const inputs = [
      "Refused to connect to '" + 'a'.repeat(50_000) + DOCUMENT,
      'Refused to ' + "'".repeat(50_000),
      'Fetch API cannot load ' + 'x'.repeat(50_000),
      'Fetch API cannot load ' + 'x. '.repeat(20_000),
      "Refused to connect to 'https://" + HOST.repeat(5_000) + "' " + DOCUMENT,
    ];
    for (const input of inputs) {
      expect(isBlockedTelemetryRefusal(input)).toBe(false);
    }
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('blockedUrlOf', () => {
  it('reads the quoted URL, or the fetch wording, or nothing', () => {
    expect(
      blockedUrlOf(`Refused to connect to 'https://a.test/x' ${DOCUMENT}`),
    ).toBe('https://a.test/x');
    expect(
      blockedUrlOf(
        `Fetch API cannot load https://a.test/x. Refused to connect ${DOCUMENT}`,
      ),
    ).toBe('https://a.test/x');
    expect(blockedUrlOf('nothing to see')).toBeNull();
  });
});
