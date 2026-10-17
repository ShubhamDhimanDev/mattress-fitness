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

// A class is found by its own text, not by splitting the file into words: variants and arbitrary values contain colons,
// brackets and parentheses, and copy such as "delay-free" must not look like a utility. Rules:
//  - it starts after whitespace, a quote or a backtick (or at the start), possibly behind variants ("hover:", "md:");
//  - it ends before whitespace, a quote, a backtick or the end of the text;
//  - the utility itself is one of Tailwind's motion utilities with a value Tailwind knows (a number, a keyword, an
//    arbitrary [value] or a (--variable)), so a word that merely starts like one is left alone.
// Known gaps, on purpose: class names assembled at run time (`transition-${name}`), and motion set through
// inline styles or the Web Animations API (style={{transition: ...}}, element.animate). Neither can be told from other
// code by reading text; the e2e checks in tests/e2e/design-rules.spec.ts measure the computed result in a browser. The
// bare word "transition" in visible copy would be flagged as a false positive; rephrase the copy.
// What ends a class name in source: whitespace, a quote or a backtick.
const EDGE = '\\s"\'`';
const ARBITRARY = `\\[[^\\]${EDGE}]+\\]`;
const VARIABLE = `\\([^)${EDGE}]+\\)`;
const MOTION_UTILITIES = [
  // Named and arbitrary animations; "animate-none" switches one off and is allowed.
  'animate-(?!none(?![\\w-]))[a-z][\\w-]*',
  `animate-${ARBITRARY}`,
  `animate-${VARIABLE}`,
  // "transition-none" is allowed for the same reason (it is what "motion-reduce:" pairs with).
  `transition(?:-(?:all|colors|opacity|shadow|transform|discrete)|-${ARBITRARY}|-${VARIABLE})?`,
  `(?:duration|delay)-(?:\\d+|initial|${ARBITRARY}|${VARIABLE})`,
  `ease-(?:linear|in-out|in|out|initial|${ARBITRARY}|${VARIABLE})`,
  'scroll-smooth',
  // Arbitrary properties: [transition:opacity_.2s], [animation:spin_1s_linear_infinite], [scroll-behavior:smooth].
  `\\[(?:transition|animation)(?:-[a-z-]+)?:(?!none\\])[^\\]${EDGE}]*\\]`,
  '\\[scroll-behavior:smooth\\]',
];
const HOVER_MOVE_UTILITY =
  '-?(?:scale|translate|rotate|skew)(?:-[\\w[\\]/.%-]+)?';

function classPattern(utility: string): RegExp {
  return new RegExp(
    `(?<![^${EDGE}])(?<variants>(?:[^${EDGE}:]+:)*)!?(?:${utility})!?(?![^${EDGE}])`,
    'g',
  );
}

const MOTION_CLASS = classPattern(MOTION_UTILITIES.join('|'));
const HOVER_MOVE_CLASS = classPattern(HOVER_MOVE_UTILITY);

function variantsOf(match: RegExpMatchArray): string[] {
  return (match.groups?.variants ?? '').split(':').filter(Boolean);
}

/**
 * Class tokens that move something without a `motion-safe:` variant: animations, transitions, durations, delays,
 * easing, smooth scrolling and (with a hover variant) scale, translate, rotate and skew. So
 * `hover:motion-safe:transition-colors` counts as guarded and `group-hover:scale-105` does not.
 */
export function unguardedMotionClasses(source: string): string[] {
  const text = withoutComments(source);
  const found: string[] = [];
  for (const match of text.matchAll(MOTION_CLASS)) {
    if (!variantsOf(match).includes('motion-safe')) found.push(match[0]);
  }
  for (const match of text.matchAll(HOVER_MOVE_CLASS)) {
    const variants = variantsOf(match);
    const hovers = variants.some((variant) => /(?:^|-)hover$/.test(variant));
    if (hovers && !variants.includes('motion-safe')) found.push(match[0]);
  }
  return found;
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

  // The guard must be able to fail: stripping the prefix from each file that uses it has to produce a violation in that
  // file. (Mutation check; the classes of the six files that were fixed in 12034ce are among them.)
  it('flags each file that uses motion-safe: once the prefix is taken out', () => {
    const users = sources.filter(({text}) =>
      withoutComments(text).includes('motion-safe:'),
    );
    expect(users.map(({file}) => file)).toEqual(
      expect.arrayContaining([
        'components/ProductItem.tsx',
        'components/collection/PromoTileCard.tsx',
        'components/layout/SiteFooter.tsx',
        'components/layout/MainNav.tsx',
        'components/quiz/QuizQuestion.tsx',
        'components/quiz/QuizProgress.tsx',
      ]),
    );
    for (const {file, text} of users) {
      const mutated = text.replaceAll('motion-safe:', '');
      expect(unguardedMotionClasses(mutated), file).not.toEqual([]);
    }
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

  it('accept the classes that switch motion off', () => {
    expect(
      unguardedMotionClasses(
        'x="motion-reduce:transition-none animate-none transition-none motion-reduce:animate-none"',
      ),
    ).toEqual([]);
  });

  it('flag arbitrary values and arbitrary properties, with or without variants', () => {
    expect(
      unguardedMotionClasses(
        'x="animate-[wiggle_1s_ease-in-out_infinite] md:transition-[width] duration-[300ms] ease-[cubic-bezier(0.4,0,0.2,1)] delay-(--wait) animate-(--spin)"',
      ),
    ).toEqual([
      'animate-[wiggle_1s_ease-in-out_infinite]',
      'md:transition-[width]',
      'duration-[300ms]',
      'ease-[cubic-bezier(0.4,0,0.2,1)]',
      'delay-(--wait)',
      'animate-(--spin)',
    ]);
    expect(
      unguardedMotionClasses(
        'x="[transition:opacity_.2s] hover:[transition-property:opacity] [animation:spin_1s_linear_infinite] [scroll-behavior:smooth]"',
      ),
    ).toEqual([
      '[transition:opacity_.2s]',
      'hover:[transition-property:opacity]',
      '[animation:spin_1s_linear_infinite]',
      '[scroll-behavior:smooth]',
    ]);
    expect(
      unguardedMotionClasses(
        'x="motion-safe:animate-[wiggle_1s_infinite] motion-safe:[transition:opacity_.2s] hover:motion-safe:ease-[linear] [transition:none] [animation:none]"',
      ),
    ).toEqual([]);
  });

  it('flag the important modifier too', () => {
    expect(
      unguardedMotionClasses('x="!transition-colors duration-200!"'),
    ).toEqual(['!transition-colors', 'duration-200!']);
  });

  it('do not read words that only look like a utility', () => {
    // Visible copy and identifiers: not preceded and followed by class edges, or not a value Tailwind knows.
    expect(
      unguardedMotionClasses(
        '<p>A delay-free checkout with ease-of-use and a duration-less plan. transition-ready, animate_me</p>',
      ),
    ).toEqual([]);
    expect(unguardedMotionClasses('const x = a.transition-1;')).toEqual([]);
    expect(
      unguardedMotionClasses('x="ease-in-place duration-fast delay-"'),
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
