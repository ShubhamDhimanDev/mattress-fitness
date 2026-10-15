import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';

// B-20: React Router drops a finished mounted fetcher from useFetchers(), so a cart form only reports its server answer
// to CartMessages when it goes through CartActionForm or useCartSubmit. A bare <CartForm> or a fetcher posting to /cart
// would silently drop errors again, so this guard fails the build instead of relying on convention.
const APP = join(__dirname, '../../../app');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('cart forms report their result', () => {
  const files = sourceFiles(APP);

  it('has no bare <CartForm> outside CartActionForm', () => {
    const offenders = files.filter(
      (file) =>
        !file.endsWith('CartActionForm.tsx') &&
        /<CartForm[\s>]/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('submits to /cart from a fetcher only inside useCartSubmit', () => {
    const offenders = files.filter(
      (file) =>
        !file.endsWith('useCartSubmit.ts') &&
        /\.submit\([^)]*['"]\/cart['"]/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
