import {existsSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';

// CR-31 R1 (DEC-134): the self-hosted font, the type utilities and the shape and width tokens. Plain file checks, because
// jsdom has no layout and the browser result is looked at in the gallery.

const ROOT = process.cwd();
const css = readFileSync(join(ROOT, 'app', 'styles', 'tailwind.css'), 'utf8');
const rootTsx = readFileSync(join(ROOT, 'app', 'root.tsx'), 'utf8');
const FONT = join(ROOT, 'public', 'fonts', 'PlusJakartaSans-Variable.woff2');
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

function utilityBody(name: string): string {
  const match = new RegExp(`@utility ${name}\\s*\\{([^}]*)\\}`).exec(
    withoutComments,
  );
  return match?.[1] ?? '';
}

describe('Plus Jakarta Sans (self-hosted)', () => {
  it('ships one WOFF2 file with its licence, and the file is a real WOFF2 under 40 KB', () => {
    expect(existsSync(FONT)).toBe(true);
    expect(readFileSync(FONT).subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(statSync(FONT).size).toBeLessThan(40 * 1024);
    const licence = readFileSync(
      join(ROOT, 'public', 'fonts', 'LICENSE-PlusJakartaSans.txt'),
      'utf8',
    );
    expect(licence).toContain('SIL Open Font License, Version 1.1');
    expect(licence).toContain('The Plus Jakarta Sans Project Authors');
  });

  it('declares the variable face with swap and a 200 to 800 weight range, from the same origin', () => {
    expect(withoutComments).toMatch(
      /@font-face\s*\{[^}]*font-family: 'Plus Jakarta Sans';[^}]*font-weight: 200 800;[^}]*font-display: swap;[^}]*url\('\/fonts\/PlusJakartaSans-Variable\.woff2'\)/,
    );
  });

  it('declares a metric-adjusted fallback face and puts it right after the font in both stacks', () => {
    const fallback =
      /@font-face\s*\{[^}]*'Plus Jakarta Sans Fallback'[^}]*\}/.exec(
        withoutComments,
      )?.[0];
    expect(fallback).toContain('size-adjust');
    expect(fallback).toContain('ascent-override');
    expect(fallback).toContain('descent-override');
    expect(fallback).toContain('line-gap-override');
    for (const name of ['font-sans', 'font-display']) {
      expect(withoutComments).toMatch(
        new RegExp(
          `--${name}:\\s*'Plus Jakarta Sans', 'Plus Jakarta Sans Fallback', system-ui`,
        ),
      );
    }
  });

  it('makes no third-party font request: no CDN URL in the stylesheet, and font-src stays self', () => {
    expect(css).not.toMatch(/googleapis|gstatic|typekit|fonts\.bunny/i);
    expect(
      readFileSync(join(ROOT, 'app', 'lib', 'security-headers.ts'), 'utf8'),
    ).toContain(`['font-src', ["'self'"`);
  });

  it('preloads exactly that one file, as a cross-origin font', () => {
    expect(rootTsx).toContain("href: '/fonts/PlusJakartaSans-Variable.woff2'");
    expect(rootTsx).toContain("as: 'font'");
    expect(rootTsx).toContain("type: 'font/woff2'");
    expect(rootTsx).toContain("crossOrigin: 'anonymous'");
    expect(rootTsx.match(/rel: 'preload'/g)).toHaveLength(1);
  });
});

describe('type utilities', () => {
  it('type-display is heavy, tight and sentence case (no capitals), and keeps overflow-wrap: anywhere', () => {
    const body = utilityBody('type-display');
    expect(body).toContain('font-weight: 800');
    expect(body).toContain('letter-spacing: -0.03em');
    expect(body).toContain('overflow-wrap: anywhere');
    expect(body).not.toContain('text-transform');
    expect(body).toMatch(/line-height: 1\.0[5-9]|line-height: 1\.1\b/);
  });

  it('type-eyebrow is 13 px, bold, wide-tracked capitals in the deep red', () => {
    const body = utilityBody('type-eyebrow');
    expect(body).toContain('font-size: var(--text-caption)');
    expect(body).toContain('font-weight: 700');
    expect(body).toContain('letter-spacing: 0.14em');
    expect(body).toContain('text-transform: uppercase');
    expect(body).toContain('color: var(--color-primary-700)');
    expect(withoutComments).toContain('--text-caption: 0.8125rem');
  });

  it('type-mark is the red highlight: white text, 0.16em padding, rounded, clones across lines', () => {
    const body = utilityBody('type-mark');
    expect(body).toContain('background-color: var(--color-primary-500)');
    expect(body).toContain('color: var(--color-white)');
    expect(body).toContain('padding-inline: 0.16em');
    expect(body).toContain('border-radius: var(--radius-mark)');
    expect(body).toContain('box-decoration-break: clone');
  });

  it('bare h1 to h3 are weight 800 with -0.02em tracking', () => {
    for (const tag of ['h1', 'h2', 'h3']) {
      const body = new RegExp(`\\n  ${tag} \\{([^}]*)\\}`).exec(
        withoutComments,
      )?.[1];
      expect(body, tag).toContain('font-weight: 800');
      expect(body, tag).toContain('letter-spacing: -0.02em');
    }
  });

  it('the display scale steps are 68 px (desktop), 46 px (phone) and 40 px (heading)', () => {
    expect(withoutComments).toContain('--text-display: 4.25rem');
    expect(withoutComments).toContain('--text-hero: 2.875rem');
    expect(withoutComments).toContain('--text-heading: 2.5rem');
  });
});

describe('shape, depth and width tokens', () => {
  const value = (name: string) =>
    new RegExp(`--${name}:\\s*([^;]+);`).exec(withoutComments)?.[1]?.trim();

  it.each([
    ['radius-sm', '0.5rem'],
    ['radius-choice', '0.75rem'],
    ['radius-card', '1.125rem'],
    ['radius-panel', '1.5rem'],
    ['radius-hero', '1.75rem'],
    ['radius-pill', '9999px'],
    ['container-page', '87.5rem'],
    ['container-drawer', '27.5rem'],
    ['shadow-lift', '0 12px 40px -12px rgb(20 20 20 / 0.18)'],
  ])('--%s is %s', (name, expected) => {
    expect(value(name)).toBe(expected);
  });

  it('keeps shadow-drawer as the deep shadow', () => {
    expect(value('shadow-drawer')).toBe('0 0 48px rgb(20 20 20 / 0.28)');
  });

  it('the legacy drawer width matches the drawer token', () => {
    expect(
      readFileSync(join(ROOT, 'app', 'styles', 'app.css'), 'utf8'),
    ).toContain('--aside-width: 440px');
  });
});
