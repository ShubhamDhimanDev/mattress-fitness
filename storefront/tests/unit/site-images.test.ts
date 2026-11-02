// REQ-HOME-001 (CR-31): the bundled photographs the storefront falls back to must exist on disk.
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {SITE_IMAGES, type SiteImage} from '~/lib/site-images';

const PUBLIC_DIR = resolve(__dirname, '../../public');

const ALL: readonly SiteImage[] = Object.values(SITE_IMAGES).flat();

describe('bundled site images', () => {
  it('has one fallback picture for each of the three setup cards', () => {
    expect(SITE_IMAGES.homeSetup).toHaveLength(3);
  });

  it.each(ALL.map((image) => [image.src, image] as const))(
    '%s and every width in its srcset exist in public/',
    (_src, image) => {
      const urls = [
        image.src,
        ...image.srcSet.split(',').map((entry) => entry.trim().split(' ')[0]),
      ];
      for (const url of urls) {
        expect(existsSync(resolve(PUBLIC_DIR, `.${url}`)), url).toBe(true);
      }
      expect(image.width).toBeGreaterThan(0);
      expect(image.height).toBeGreaterThan(0);
    },
  );
});
