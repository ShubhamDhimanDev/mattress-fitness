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
  'app/lib/analytics.ts':
    'development-only debug of tracked events until the analytics sink exists (P7-01)',
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

// Any use of the `console` identifier outside comments: a call, `.catch(console.error)`, an alias (`const log = console`)
// or a destructure. A property access such as `window.console` is not matched by design (nothing here uses one).
const CONSOLE_CALL = /(^|[^\w.'"`])console\b/m;

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
  const offenders = [...sourceFiles(APP_DIR), join(process.cwd(), 'server.ts')]
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

describe('the guard itself', () => {
  it.each([
    'console.error("x")',
    'promise.catch(console.error)',
    'const log = console;',
    'const {error} = console;',
    'queueMicrotask(() => console.warn(e))',
  ])('catches %s', (code) => {
    expect(CONSOLE_CALL.test(code)).toBe(true);
  });

  it.each([
    'consoleLogger(event)',
    'window.console.log(x)',
    '// console.error in a comment',
    "const text = 'console';",
  ])('ignores %s', (code) => {
    expect(CONSOLE_CALL.test(withoutComments(code))).toBe(false);
  });
});
