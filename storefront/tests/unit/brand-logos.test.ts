// REQ-COL-005, REQ-HOME-001: the bundled brand logos match the seeded brands and exist on disk.
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {bundledBrandLogo} from '~/lib/brand-logos';

const PUBLIC_DIR = resolve(__dirname, '../../public');

const SEEDED_BRANDS: readonly [handle: string, name: string][] = [
  ['tempur-pedic', 'Tempur-Pedic'],
  ['stearns-and-foster', 'Stearns & Foster'],
  ['sealy', 'Sealy'],
  ['molecule', 'Molecule'],
  ['serta', 'Serta'],
  ['brooklyn-bedding', 'Brooklyn Bedding'],
  ['helix', 'Helix'],
  ['puffy', 'Puffy'],
  ['beautyrest', 'Beautyrest'],
  ['aireloom', 'Aireloom'],
  ['kingsdown', 'Kingsdown'],
  ['casper', 'Casper'],
];

describe('bundledBrandLogo', () => {
  it.each(SEEDED_BRANDS)('finds %s by handle and by name', (handle, name) => {
    const byHandle = bundledBrandLogo(handle);
    expect(byHandle).not.toBeNull();
    expect(bundledBrandLogo(null, name)).toEqual(byHandle);
    expect(existsSync(resolve(PUBLIC_DIR, `.${byHandle?.url}`))).toBe(true);
    expect(byHandle?.width).toBeGreaterThan(0);
    expect(byHandle?.height).toBeGreaterThan(0);
  });

  it('knows the ampersand spelling of a name', () => {
    expect(bundledBrandLogo('Stearns & Foster')?.url).toContain(
      'stearns-and-foster',
    );
  });

  it('returns null for a brand without a bundled logo and for empty input', () => {
    expect(bundledBrandLogo('acme-sleep', 'Acme Sleep')).toBeNull();
    expect(bundledBrandLogo(null, undefined, '')).toBeNull();
  });
});
