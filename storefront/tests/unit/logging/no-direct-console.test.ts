import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {describe, expect, it} from 'vitest';

// NFR-010, T-05 (P7-08): server code logs through app/lib/logging/logger.ts so that every line is structured and
// redacted. This guard fails when a new direct `console.*` call appears in app/, so the rule does not rot.

const APP_DIR = join(process.cwd(), 'app');

/**
 * Files that may still call `console` directly, each with the reason. The logger itself is the one permanent
 * entry; the others are owned by work that was in flight when the logger landed and move over when it is
 * next touched (P7-08 follow-up).
 */
const ALLOWED: Readonly<Record<string, string>> = {
  'app/lib/logging/logger.ts': 'the sink: the only place that touches console',
  'app/components/ui/Price.tsx':
    'client-side component; logs a fixed currency message that tests and e2e match on (no personal data)',
  'app/lib/pages/track.ts':
    'development-only debug of quiz events until the analytics sink exists (P7-01)',
  'app/routes/cart.tsx': 'cart route, owned by the cart work',
  'app/routes/checkout-steps.tsx': 'cart gate route, owned by the cart work',
  'app/lib/offers-runtime/server.ts': 'offers runtime, owned by the cart work',
  'app/lib/offers-runtime/facts.ts': 'offers runtime, owned by the cart work',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|generated)\./.test(name)
      ? [path]
      : [];
  });
}

// A call, not a mention in a comment: `console.warn(` at the start of an expression or after punctuation.
const CONSOLE_CALL =
  /(^|[^\w.'"`])console\.(log|info|debug|warn|error|trace)\s*\(/m;

function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '');
}

function read(file: string): string {
  return withoutComments(readFileSync(join(process.cwd(), file), 'utf8'));
}

describe('structured logging only (NFR-010, T-05)', () => {
  const offenders = sourceFiles(APP_DIR)
    .map((file) => relative(process.cwd(), file).split(sep).join('/'))
    .filter((file) => !(file in ALLOWED))
    .filter((file) => CONSOLE_CALL.test(read(file)));

  it('no file outside the allow-list calls console directly', () => {
    expect(offenders).toEqual([]);
  });

  it('every allow-listed file still needs its entry (the list does not grow stale)', () => {
    for (const file of Object.keys(ALLOWED)) {
      expect(CONSOLE_CALL.test(read(file)), file).toBe(true);
    }
  });
});
