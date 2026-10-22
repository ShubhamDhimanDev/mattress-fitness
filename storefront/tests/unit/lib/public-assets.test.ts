import {readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';

// NFR-002 / BA-02: everything in public/ is shipped in the client build and fetchable by anyone, so no master or
// source artwork may live there. The 543 kB logo master sits in brand-source/ instead.

const PUBLIC_DIR = join(process.cwd(), 'public');
const MAX_BYTES = 200 * 1024;

function filesUnder(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

describe('public/ assets', () => {
  it('contains no file larger than 200 kB', () => {
    const tooBig = filesUnder(PUBLIC_DIR)
      .map((path) => ({path, bytes: statSync(path).size}))
      .filter((file) => file.bytes > MAX_BYTES)
      .map((file) => `${file.path} (${file.bytes} bytes)`);
    expect(tooBig).toEqual([]);
  });

  it('keeps the logo master outside public/', () => {
    const names = filesUnder(PUBLIC_DIR).map((path) => path.toLowerCase());
    expect(names.some((name) => name.includes('original'))).toBe(false);
    expect(
      statSync(
        join(
          process.cwd(),
          'brand-source',
          'mattress-fitness-logo-original.png',
        ),
      ).isFile(),
    ).toBe(true);
  });
});
