import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';

// P2-07 / NFR-003 (WCAG 2.3.3): shared components never move on their own when the shopper asks for reduced
// motion. Every animation or transition class in app/components/ui must sit behind `motion-safe:`. The base layer
// in styles/tailwind.css also shortens all motion under prefers-reduced-motion; this guard keeps the component
// side explicit so the rule survives a change to that file. Layout components are checked by the layout owner.

const UI_DIR = join(process.cwd(), 'app', 'components', 'ui');
const CSS_FILE = join(process.cwd(), 'app', 'styles', 'tailwind.css');

/** `animate-*` and `transition*` utilities that are not directly preceded by a `motion-safe:` variant. */
const UNGUARDED =
  /(?<![\w:-])(?:animate-[\w-]+|transition(?:-[\w[\]-]+)?)(?![\w-])/g;

function motionClasses(source: string): string[] {
  // Tokens are matched inside string literals; variants such as `hover:` before `motion-safe:` are fine because
  // the lookbehind only rejects a match whose previous character is part of a class name or variant.
  return source.match(UNGUARDED) ?? [];
}

function uiSources(): Array<{file: string; text: string}> {
  return readdirSync(UI_DIR)
    .filter((name) => /\.tsx?$/.test(name))
    .map((file) => ({file, text: readFileSync(join(UI_DIR, file), 'utf8')}));
}

describe('shared UI motion is behind motion-safe (P2-07)', () => {
  const sources = uiSources().map(({file, text}): [string, string] => [
    file,
    text,
  ]);

  it.each(sources)(
    '%s has no animation or transition outside motion-safe:',
    (_file, text) => {
      expect(motionClasses(text)).toEqual([]);
    },
  );

  it('the guard catches an unguarded class and accepts a guarded one', () => {
    expect(motionClasses('class="animate-spin"')).toEqual(['animate-spin']);
    expect(motionClasses('class="size-5 transition-colors"')).toEqual([
      'transition-colors',
    ]);
    expect(motionClasses('class="transition-[width]"')).toEqual([
      'transition-[width]',
    ]);
    expect(motionClasses('class="motion-safe:animate-spin"')).toEqual([]);
    expect(
      motionClasses('class="hover:motion-safe:transition-colors"'),
    ).toEqual([]);
    expect(motionClasses('class="group-aria-expanded:rotate-180"')).toEqual([]);
  });

  it('the base layer still shortens motion under prefers-reduced-motion', () => {
    const css = readFileSync(CSS_FILE, 'utf8');
    const pattern = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/;
    const block = pattern.exec(css)?.[0];
    expect(block).toContain('animation-duration: 0.01ms !important');
    expect(block).toContain('transition-duration: 0.01ms !important');
    expect(block).toContain('scroll-behavior: auto !important');
  });
});
