import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {BRAND_THEME_COLOR} from '~/lib/brand';

// BA-01 / BA-03, NFR-003 (WCAG 2.2 AA, pending approval Q-012): every foreground/background pair the design
// system relies on, recomputed from the custom properties in app/styles/tailwind.css, so a palette edit cannot
// silently drop under 4.5:1 (text) or 3:1 (non-text UI such as borders, icons and the focus ring).
// Pairs come from docs/design/BRAND_APPLICATION_SPEC.md sections 2 and 5.1.

const CSS_FILE = join(process.cwd(), 'app', 'styles', 'tailwind.css');
const TEXT = 4.5;
const UI = 3;

type Rgb = readonly [number, number, number];

/** Custom properties with a literal hex value, in the `@theme` block (comments removed first). */
function readColors(css: string): Map<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const colors = new Map<string, string>();
  for (const match of withoutComments.matchAll(
    /--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g,
  )) {
    const [, name, hex] = match;
    if (name && hex) colors.set(name, hex.toLowerCase());
  }
  return colors;
}

/** Semantic roles (`@theme inline`): `--color-fg: var(--color-ink-900)` resolves to a palette name. */
function readRoles(css: string): Map<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const roles = new Map<string, string>();
  for (const match of withoutComments.matchAll(
    /--color-([a-z0-9-]+):\s*var\(--color-([a-z0-9-]+)\)\s*;/g,
  )) {
    const [, role, target] = match;
    if (role && target) roles.set(role, target);
  }
  return roles;
}

const css = readFileSync(CSS_FILE, 'utf8');
const colors = readColors(css);
const roles = readRoles(css);

function hexOf(token: string): string {
  const resolved = roles.get(token) ?? token;
  const hex = colors.get(resolved);
  if (!hex) throw new Error(`No colour token "${token}" in tailwind.css`);
  return hex;
}

function toRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** WCAG 2.2 relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(toRgb(hexOf(foreground)));
  const b = luminance(toRgb(hexOf(background)));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Hue in degrees (0 to 360) of a palette colour. */
function hue(token: string): number {
  const [r, g, b] = toRgb(hexOf(token)).map((channel) => channel / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const sector =
    max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return (sector * 60 + 360) % 360;
}

type Pair = readonly [foreground: string, background: string, use: string];

// Text pairs: need 4.5.
const TEXT_PAIRS: readonly Pair[] = [
  // Brand red scale
  [
    'white',
    'primary-500',
    'primary button label, promo bar, count bubble, selected size',
  ],
  ['white', 'primary-600', 'primary button hover'],
  ['white', 'primary-700', 'primary button pressed'],
  ['primary-500', 'white', 'red text on white only'],
  ['primary-700', 'white', 'link, secondary and inverse button label'],
  ['primary-700', 'ink-100', 'red text on a grey surface'],
  ['primary-700', 'ink-50', 'red text on a subtle panel'],
  ['primary-700', 'primary-50', 'secondary button hover, inverse hover'],
  ['primary-700', 'primary-100', 'secondary button pressed, inverse pressed'],
  ['primary-800', 'primary-50', 'chips and tag text on a tint'],
  ['primary-800', 'white', 'link hover'],
  ['primary-800', 'ink-100', 'link hover on grey'],
  ['primary-400', 'ink-900', 'red text on black'],
  ['primary-200', 'ink-900', 'tinted text on black'],
  ['primary-300', 'ink-900', 'eyebrow on a dark band'],
  // Button variants on their surfaces
  ['white', 'primary-500', 'inverse-outline label on the red band'],
  ['ink-900', 'accent-400', 'accent button, sale badge'],
  ['ink-900', 'accent-300', 'accent button hover'],
  ['ink-900', 'accent-500', 'accent button pressed'],
  // Neutrals
  ['fg', 'surface', 'body text'],
  ['fg', 'surface-muted', 'body text on grey'],
  ['fg-muted', 'surface', 'secondary text'],
  ['fg-muted', 'surface-muted', 'secondary text on grey'],
  ['fg-inverse', 'surface-inverse', 'text on the black band'],
  ['white', 'surface-inverse', 'white on the black band, new badge'],
  ['white', 'ink-800', 'category tile without an image'],
  ['ink-700', 'ink-100', 'utility bar and footer links, neutral badge'],
  ['ink-700', 'white', 'neutral badge on white'],
  ['ink-500', 'white', 'placeholder text on white'],
  ['ink-600', 'ink-50', 'helper text on a subtle panel'],
  // Sale and accent
  ['sale-fg', 'white', 'sale price and savings'],
  ['sale-fg', 'sale-bg', 'sale callout panel'],
  ['sale-fg', 'ink-100', 'sale price on a grey card'],
  ['ink-600', 'sale-bg', 'muted text in a sale callout'],
  ['accent-700', 'white', 'amber text on a light surface'],
  // Warm paper (CR-31): bands, the cart page background, tinted cards, chips, hovered quiet buttons
  ['ink-900', 'paper', 'body text on a band (16.79)'],
  ['ink-700', 'paper', 'chip text, footer links on a band (9.90)'],
  ['ink-600', 'paper', 'muted text on a band (6.90)'],
  ['ink-500', 'paper', 'placeholder text on a band (4.65)'],
  [
    'primary-500',
    'paper',
    'red text on paper: only at 16 px and larger (4.63), small red text uses primary-700',
  ],
  ['primary-700', 'paper', 'links and eyebrows on a band (7.13)'],
  ['primary-800', 'paper', 'link hover on a band'],
  ['sale-fg', 'paper', 'savings amount on a band'],
  ['success-fg', 'paper', 'success text on a band'],
  ['error-fg', 'paper', 'error text on a band'],
  ['accent-700', 'paper', 'amber text on a band'],
  ['ink-900', 'accent-50', 'free-gift card text'],
  ['ink-600', 'accent-50', 'muted text in the free-gift card'],
  [
    'sale-fg',
    'accent-50',
    'struck-through value and savings in the free-gift card',
  ],
  // Button states added with the redesign
  ['white', 'ink-700', 'dark button hover'],
  ['white', 'ink-800', 'dark button pressed'],
  ['ink-900', 'paper', 'white and outline button hover'],
  [
    'ink-900',
    'ink-100',
    'white and outline button pressed, soft icon button hover',
  ],
  ['primary-800', 'white', 'link button hover'],
  ['primary-900', 'white', 'link button pressed'],
  // Status
  ['success-fg', 'success-bg', 'success message'],
  ['warning-fg', 'warning-bg', 'warning message'],
  ['error-fg', 'error-bg', 'error message'],
  ['error-fg', 'white', 'error text on white'],
  ['white', 'success-solid', 'success solid'],
  ['white', 'error-solid', 'error solid'],
  ['ink-900', 'warning-solid', 'warning solid'],
];

// Non-text pairs: need 3.
const UI_PAIRS: readonly Pair[] = [
  ['line-strong', 'white', 'control border on white'],
  ['ink-500', 'ink-100', 'control border on a grey surface'],
  ['ink-500', 'ink-50', 'control border on a subtle panel'],
  ['primary-500', 'white', 'secondary button border, icons, 2 px red borders'],
  ['error-solid', 'white', 'invalid field border'],
  ['error-solid', 'error-bg', 'error box border'],
  ['ink-900', 'white', 'filled star'],
  ['focus', 'white', 'focus ring on white'],
  ['focus', 'ink-50', 'focus ring on a subtle panel'],
  ['focus', 'ink-100', 'focus ring on grey (footer, utility bar)'],
  ['focus', 'ink-200', 'focus ring on hairline grey'],
  ['ink-400', 'paper', 'control border on a band (3.07)'],
  ['focus', 'paper', 'focus ring on a band'],
  ['focus', 'accent-50', 'focus ring on the free-gift card'],
  ['primary-500', 'ink-100', 'progress bar fill (red) against its track'],
  ['success-solid', 'ink-100', 'progress bar fill (success) against its track'],
  ['primary-500', 'paper', 'tab bar and secondary button border on a band'],
  ['error-solid', 'paper', 'invalid field border on a band'],
  ['focus', 'primary-50', 'focus ring on a red tint'],
  ['focus', 'primary-100', 'focus ring on a red tint, pressed'],
  ['focus-inverse', 'ink-900', 'yellow ring on black (.on-dark)'],
  ['focus-inverse', 'ink-800', 'yellow ring on dark grey (.on-dark)'],
  ['focus-inverse', 'primary-500', 'yellow ring on the red band (.on-dark)'],
  ['focus-inverse', 'primary-600', 'yellow ring on red hover'],
  ['focus-inverse', 'primary-700', 'yellow ring on red pressed'],
  ['focus-inverse', 'primary-800', 'yellow ring on dark red'],
];

/** Contrast of white text on a colour drawn at `alpha` over a solid backdrop (the category-tile label overlay). */
function whiteOnOverlay(
  overlay: string,
  alpha: number,
  backdrop: string,
): number {
  const over = toRgb(hexOf(overlay));
  const under = toRgb(hexOf(backdrop));
  const mix = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
  const blended: Rgb = [
    mix(over[0], under[0]),
    mix(over[1], under[1]),
    mix(over[2], under[2]),
  ];
  return (
    (luminance(toRgb(hexOf('white'))) + 0.05) / (luminance(blended) + 0.05)
  );
}

describe('design tokens: contrast (NFR-003)', () => {
  it('parses the palette from tailwind.css', () => {
    expect(colors.get('primary-500')).toBe('#de0510'); // the logo red
    expect(roles.get('fg')).toBe('ink-900');
    expect(colors.size).toBeGreaterThan(40);
  });

  it('computes the WCAG formula correctly (worked example: white on the logo red is 5.08)', () => {
    expect(contrast('white', 'primary-500')).toBeCloseTo(5.08, 2);
    expect(contrast('white', 'white')).toBeCloseTo(1, 5);
    expect(contrast('ink-900', 'white')).toBeCloseTo(18.42, 2);
  });

  it.each(TEXT_PAIRS)(
    'text: %s on %s is at least 4.5:1 (%s)',
    (foreground, background) => {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(TEXT);
    },
  );

  it.each(UI_PAIRS)(
    'non-text: %s against %s is at least 3:1 (%s)',
    (foreground, background) => {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(UI);
    },
  );

  // The spec's "never do this" pairs. They stay documented failures: if one starts passing the rule in the
  // palette comment is stale, and if the base colour changes these show which surfaces need re-checking.
  it.each<Pair>([
    ['primary-500', 'ink-100', 'red text on grey: use primary-700'],
    ['ink-500', 'ink-100', 'placeholder or helper text on grey: use ink-600'],
    ['focus', 'primary-500', 'blue ring on red: use .on-dark'],
    ['focus', 'ink-900', 'blue ring on black: use .on-dark'],
  ])('known unsafe pair: %s on %s stays below its minimum (%s)', (fg, bg) => {
    const ratio = contrast(fg, bg);
    const minimum = fg === 'focus' ? UI : TEXT;
    expect(ratio).toBeLessThan(minimum);
  });

  // CatalogSections: label on `bg-ink-900/60` over a photo. The photo is unknown, so the worst case is a white one.
  it('category tile label: white on ink-900 at 60% over white is at least 4.5:1 (4.81)', () => {
    const ratio = whiteOnOverlay('ink-900', 0.6, 'white');
    expect(ratio).toBeGreaterThanOrEqual(TEXT);
    expect(ratio).toBeCloseTo(4.81, 2);
  });

  it('the browser theme colour is the --color-primary-500 value in tailwind.css (one logo red, two places)', () => {
    expect(BRAND_THEME_COLOR.toLowerCase()).toBe(colors.get('primary-500'));
  });

  it('flips the focus ring to the inverse colour on .on-dark surfaces', () => {
    const onDark = /\.on-dark\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(onDark).toContain('--focus-ring-color: var(--color-focus-inverse)');
    expect(css).toContain('--focus-ring-color: var(--color-focus);');
  });

  // The sale colour must never read as the brand red or as the error red (UXD-14, UXD-19).
  it('keeps sale colours at least 20 degrees of hue away from the brand red', () => {
    const distance = (a: number, b: number) => {
      const raw = Math.abs(a - b) % 360;
      return Math.min(raw, 360 - raw);
    };
    expect(distance(hue('sale-fg'), hue('primary-500'))).toBeGreaterThanOrEqual(
      20,
    );
    expect(
      distance(hue('accent-400'), hue('primary-500')),
    ).toBeGreaterThanOrEqual(20);
    expect(distance(hue('sale-fg'), hue('error-solid'))).toBeGreaterThanOrEqual(
      15,
    );
  });

  it('keeps the token names the components use (a re-skin must not need class edits)', () => {
    for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      expect(colors.has(`primary-${step}`), `primary-${step}`).toBe(true);
      expect(colors.has(`ink-${step}`), `ink-${step}`).toBe(true);
    }
    for (const name of [
      'accent-400',
      'sale-fg',
      'sale-bg',
      'focus',
      'focus-inverse',
      'paper',
      'paper-line',
    ]) {
      expect(colors.has(name), name).toBe(true);
    }
  });

  // CR-31: the warm neutrals and the roles that point at them (REDESIGN_PLAN section 3).
  it('uses the warm paper for muted surfaces and the warm hairline for dividers', () => {
    expect(colors.get('paper')).toBe('#f7f4ef');
    expect(colors.get('paper-line')).toBe('#e6e2dc');
    expect(roles.get('surface-muted')).toBe('paper');
    expect(roles.get('line')).toBe('paper-line');
  });

  it('matches the ratios quoted in the palette comment for the paper pairs', () => {
    expect(contrast('ink-900', 'paper')).toBeCloseTo(16.79, 2);
    expect(contrast('ink-600', 'paper')).toBeCloseTo(6.9, 2);
    expect(contrast('primary-500', 'paper')).toBeCloseTo(4.63, 2);
    expect(contrast('ink-400', 'paper')).toBeCloseTo(3.07, 2);
  });

  // The hairline is decoration (1.29:1 on white): a control never relies on it as its only edge. Control borders use
  // line-strong (ink-400), which the pairs above check.
  it('keeps the hairline decorative and the control border strong', () => {
    expect(contrast('line', 'white')).toBeLessThan(UI);
    expect(contrast('line-strong', 'white')).toBeGreaterThanOrEqual(UI);
  });
});
