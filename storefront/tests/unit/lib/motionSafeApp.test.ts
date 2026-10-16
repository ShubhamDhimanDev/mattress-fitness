import {readdirSync, readFileSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {describe, expect, it} from 'vitest';

// NFR-003 (WCAG 2.3.3): the whole app, not only app/components/ui, keeps motion behind `motion-safe:` and sends
// every smooth scroll through `scrollBehavior()` (app/lib/motion.ts). The base layer in styles/tailwind.css also
// shortens all motion under prefers-reduced-motion; this guard keeps each component explicit so the rule survives
// a change to that file. tests/unit/ui/motionSafe.test.ts keeps the finer per-file checks for the shared UI.

const APP_DIR = join(process.cwd(), 'app');

/** Files that may name smooth scrolling because they are where it is decided. Keep this list this short. */
const SCROLL_ALLOW_LIST = new Set(['lib/motion.ts']);

function walk(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function appFiles(pattern: RegExp): Array<{file: string; text: string}> {
  return walk(APP_DIR)
    .filter((path) => pattern.test(path) && !/\.test\.tsx?$/.test(path))
    .map((path) => ({
      file: relative(APP_DIR, path).replaceAll(sep, '/'),
      text: readFileSync(path, 'utf8'),
    }));
}

/** Source without comments, so prose such as "view transition" is not read as a class name. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s\/\/\s.*$/gm, ' ');
}

const MOTION_UTILITY =
  /^(?:animate-[\w-]+|transition(?:-[\w[\]-]+)?|duration-[\w[\]-]+|delay-[\w[\]-]+|ease-[\w[\]-]+|scroll-smooth)$/;
const HOVER_MOVE =
  /(?:^|[:-])hover:(?:-?(?:scale|translate|rotate|skew)(?:-[\w[\]/.-]+)?)$/;

/**
 * Class tokens that move something without a `motion-safe:` variant. A token is a whitespace- or quote-separated
 * run, so `hover:motion-safe:transition-colors` counts as guarded and `group-hover:scale-105` does not.
 */
export function unguardedMotionClasses(source: string): string[] {
  return withoutComments(source)
    .split(/[\s"'`{}()]+/)
    .filter((token) => {
      if (token.includes('motion-safe:')) return false;
      const utility = token.slice(token.lastIndexOf(':') + 1);
      return MOTION_UTILITY.test(utility) || HOVER_MOVE.test(token);
    });
}

/** Script-driven scrolling that names a behaviour other than the helper's answer. */
export function unsafeScrollBehaviour(source: string): string[] {
  // Matched first, then filtered: a lookahead placed after `\s*` would backtrack past the space and wrongly
  // accept any value.
  const found = withoutComments(source).matchAll(/behavior\s*:\s*[^,}\n]+/g);
  return Array.from(found, (match) => match[0]).filter(
    (text) => !/^behavior\s*:\s*scrollBehavior\(\)/.test(text),
  );
}

describe('every app source keeps motion behind motion-safe (NFR-003)', () => {
  const sources = appFiles(/\.tsx?$/);

  it('scans the app, including the files outside components/ui', () => {
    const names = sources.map(({file}) => file);
    expect(names.length).toBeGreaterThan(100);
    for (const expected of [
      'components/layout/SiteFooter.tsx',
      'components/layout/MainNav.tsx',
      'components/quiz/QuizQuestion.tsx',
      'components/quiz/QuizProgress.tsx',
      'components/ProductItem.tsx',
      'components/collection/PromoTileCard.tsx',
      'components/product/ProductGallery.tsx',
      'components/ui/Button.tsx',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('has no animation, transition, hover movement or scroll-smooth class outside motion-safe:', () => {
    const violations = sources.flatMap(({file, text}) =>
      unguardedMotionClasses(text).map((token) => `${file}: ${token}`),
    );
    expect(violations).toEqual([]);
  });

  it('sends every script-driven scroll behaviour through scrollBehavior()', () => {
    const violations = sources
      .filter(({file}) => !SCROLL_ALLOW_LIST.has(file))
      .flatMap(({file, text}) =>
        unsafeScrollBehaviour(text).map((match) => `${file}: ${match}`),
      );
    expect(violations).toEqual([]);
  });

  it('keeps the helper the only place that names smooth scrolling', () => {
    const naming = sources
      .filter(({text}) => /['"]smooth['"]/.test(withoutComments(text)))
      .map(({file}) => file);
    expect(naming).toEqual([...SCROLL_ALLOW_LIST]);
  });
});

describe('stylesheets declare no motion of their own (NFR-003)', () => {
  const sheets = appFiles(/\.css$/);

  it('finds the stylesheets', () => {
    expect(sheets.map(({file}) => file)).toContain('styles/tailwind.css');
  });

  it('has no transition or animation declaration and no smooth scroll-behavior', () => {
    // Keyframes and `--animate-*` theme tokens are only reachable through utility classes, which the test above
    // requires to be `motion-safe:`. The reduced-motion block uses the `-duration` longhands, which do not match.
    const violations = sheets.flatMap(({file, text}) =>
      (
        withoutComments(text).match(
          /(?<![\w-])(?:transition|animation)\s*:[^;]+;|scroll-behavior\s*:\s*smooth/g,
        ) ?? []
      ).map((match) => `${file}: ${match}`),
    );
    expect(violations).toEqual([]);
  });
});

describe('the guards themselves', () => {
  it('flag unguarded motion and accept guarded motion', () => {
    expect(unguardedMotionClasses('class="size-5 transition-colors"')).toEqual([
      'transition-colors',
    ]);
    expect(unguardedMotionClasses('className="animate-spin"')).toEqual([
      'animate-spin',
    ]);
    expect(unguardedMotionClasses('x="duration-200 ease-out"')).toEqual([
      'duration-200',
      'ease-out',
    ]);
    expect(unguardedMotionClasses('x="group-hover:scale-105"')).toEqual([
      'group-hover:scale-105',
    ]);
    expect(unguardedMotionClasses('x="scroll-smooth"')).toEqual([
      'scroll-smooth',
    ]);
    expect(
      unguardedMotionClasses(
        'x="motion-safe:transition-transform motion-safe:group-hover:scale-105 hover:motion-safe:transition-colors"',
      ),
    ).toEqual([]);
  });

  it('do not read comments, state variants or positioning as motion', () => {
    expect(
      unguardedMotionClasses('// a view transition here\nconst a = 1;'),
    ).toEqual([]);
    expect(
      unguardedMotionClasses(
        'x="group-aria-expanded:rotate-180 -translate-y-1/2 rotate-180"',
      ),
    ).toEqual([]);
    expect(unguardedMotionClasses('<Link viewTransition>')).toEqual([]);
  });

  it('flag a scroll behaviour that does not come from the helper', () => {
    expect(
      unsafeScrollBehaviour("el.scrollIntoView({behavior: 'smooth'})"),
    ).toHaveLength(1);
    expect(
      unsafeScrollBehaviour("window.scrollTo({top: 0, behavior: 'auto'})"),
    ).toHaveLength(1);
    expect(
      unsafeScrollBehaviour('el.scrollIntoView({behavior: scrollBehavior()})'),
    ).toEqual([]);
  });
});
