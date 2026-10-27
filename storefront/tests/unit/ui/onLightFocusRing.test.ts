// Review finding (CR-31): `.on-dark` makes the focus ring yellow, and custom properties inherit, so a white card inside a
// dark or red band kept a 1.5:1 yellow ring on white. White cards in a band must carry `.on-light` (blue ring).
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(`../../../app/${path}`, import.meta.url), 'utf8');

describe('focus ring on white cards inside dark bands', () => {
  it('defines .on-light as the light-surface ring colour', () => {
    expect(read('styles/tailwind.css')).toMatch(
      /\.on-light\s*\{\s*--focus-ring-color:\s*var\(--color-focus\);/,
    );
  });

  it.each([
    ['components/layout/SiteFooter.tsx', 'on-light w-full max-w-xl'],
    ['components/signup/SignupForm.tsx', "'on-light flex flex-col"],
  ])('%s resets the ring on its white card', (path, snippet) => {
    expect(read(path)).toContain(snippet);
  });
});
