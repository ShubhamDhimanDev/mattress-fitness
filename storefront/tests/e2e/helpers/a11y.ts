import {AxeBuilder} from '@axe-core/playwright';
import {expect, type Page} from '@playwright/test';
import {
  BLOCKED_TELEMETRY_HOST,
  isBlockedTelemetryRefusal,
} from './telemetry-refusal';

/**
 * Runs axe on the current page state and fails on serious or critical violations (NFR-003, proposed WCAG 2.2 AA).
 * `exclude` is for third-party widgets we do not control; every use needs a comment saying why.
 */
export async function expectNoSeriousA11yViolations(
  page: Page,
  options: {exclude?: string[]; disableRules?: string[]} = {},
) {
  let builder = new AxeBuilder({page}).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
  ]);
  for (const selector of options.exclude ?? [])
    builder = builder.exclude(selector);
  if (options.disableRules?.length)
    builder = builder.disableRules(options.disableRules);

  const {violations} = await builder.analyze();
  const blocking = violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    blocking.map(
      (v) => `${v.impact}: ${v.id} (${v.nodes.length} nodes) ${v.helpUrl}`,
    ),
    'serious or critical accessibility violations',
  ).toEqual([]);
}

/**
 * Console errors that come from mock.shop, not from our code: it has no consent-management API, so Shopify's consent
 * script logs one error. They disappear when the development store is connected (P3A-01); remove the entries then.
 * Any other console error still fails the spec.
 */
export const KNOWN_MOCK_SHOP_ERRORS: readonly string[] = [
  'Shopify Customer Privacy',
];

// The telemetry refusal rule is pure and unit-tested, so it lives in ./telemetry-refusal (K-L7); re-exported here for
// the specs that already import it from this file.
export {BLOCKED_TELEMETRY_HOST, isBlockedTelemetryRefusal};

/** True for console noise that comes from the demo store or from Shopify's own blocked telemetry. */
export function isKnownConsoleNoise(text: string): boolean {
  return (
    KNOWN_MOCK_SHOP_ERRORS.some((known) => text.includes(known)) ||
    isBlockedTelemetryRefusal(text)
  );
}

/** Collects console errors so a spec can assert the page is quiet (known mock.shop noise is excluded). */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (isKnownConsoleNoise(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

// ---------------------------------------------------------------------------------------------------------------
// Accessibility audit helpers (P7-05 preparation; used by tests/e2e/a11y-audit.spec.ts). Additive: nothing above
// this line changed. Evidence from these helpers is local mock-store evidence, not a conformance claim.
// ---------------------------------------------------------------------------------------------------------------

/** The WCAG tag set the audit runs with, plus axe's best-practice rules (recorded, never gating). */
export const AUDIT_AXE_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
] as const;

export type AxeImpact = 'critical' | 'serious' | 'moderate' | 'minor';

export type AuditViolation = {
  id: string;
  impact: AxeImpact;
  /** True when the rule maps to a WCAG success criterion; false for axe best-practice rules only. */
  wcag: boolean;
  nodes: number;
  help: string;
  helpUrl: string;
  /** First few CSS targets, to find the element again. */
  targets: string[];
  /** The first node's axe message (for example the measured contrast ratio) and a short HTML excerpt. */
  detail: string;
};

/** Runs axe with the audit tag set and returns every violation, worst first. */
export async function runAxeAudit(
  page: Page,
  options: {exclude?: string[]} = {},
): Promise<AuditViolation[]> {
  let builder = new AxeBuilder({page}).withTags([...AUDIT_AXE_TAGS]);
  for (const selector of options.exclude ?? [])
    builder = builder.exclude(selector);
  const {violations} = await builder.analyze();
  const order: Record<string, number> = {
    critical: 0,
    serious: 1,
    moderate: 2,
    minor: 3,
  };
  return violations
    .map((v) => ({
      id: v.id,
      impact: (v.impact ?? 'minor') as AxeImpact,
      wcag: v.tags.some((tag) => /^wcag\d+(a|aa|aaa)$/.test(tag)),
      nodes: v.nodes.length,
      help: v.help,
      helpUrl: v.helpUrl,
      targets: v.nodes.slice(0, 3).map((node) => node.target.join(' ')),
      detail: `${v.nodes[0]?.any[0]?.message ?? v.nodes[0]?.failureSummary ?? ''} | ${(v.nodes[0]?.html ?? '').slice(0, 160)}`,
    }))
    .sort((a, b) => order[a.impact] - order[b.impact]);
}

/** One-line summary of an audit, read back when the results table is built. */
export function summariseAudit(violations: readonly AuditViolation[]): string {
  const count = (impact: AxeImpact) =>
    violations.filter((v) => v.impact === impact && v.wcag).length;
  const ids = violations.map(
    (v) => `${v.id}(${v.impact[0]}${v.nodes}${v.wcag ? '' : ',bp'})`,
  );
  return (
    `crit=${count('critical')} ser=${count('serious')} ` +
    `mod=${count('moderate')} min=${count('minor')} ` +
    `bp=${violations.filter((v) => !v.wcag).length} ids=[${ids.join(' ')}]`
  );
}

/** Serious or critical violations: the gating set (NFR-003). Best-practice-only rules are included if serious. */
export function blockingViolations(
  violations: readonly AuditViolation[],
): string[] {
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) => `${v.impact}: ${v.id} (${v.nodes} nodes) ${v.targets[0] ?? ''}`,
    );
}

export type FocusInfo = {
  /** tag, role and a short name, for reading a failure */
  label: string;
  /** A visible outline or ring is painted on the focused element or its visual proxy. */
  indicator: boolean;
  /** The centre of the focused element is covered by another element (WCAG 2.4.11). */
  obscured: boolean;
  /** The focused element is outside the visible viewport. */
  offscreen: boolean;
  /** Landmark the element sits in: banner, main, contentinfo, dialog, or other. */
  region: 'banner' | 'main' | 'contentinfo' | 'dialog' | 'other';
};

export type TabStop = FocusInfo & {index: number};

/**
 * Describes the focused element: its label, whether a focus indicator is painted (an outline with width and a
 * non-transparent colour, or a painting box-shadow layer, on the element or, for a visually hidden input, on its
 * label or siblings, where custom radios and checkboxes draw the ring) and whether anything covers it.
 */
export async function describeFocus(page: Page): Promise<FocusInfo | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement)
      return null;

    const transparent = (c: string) =>
      /^rgba\([^)]*,\s*0\)$/.test(c) || c === 'transparent';
    const paints = (node: Element): boolean => {
      const s = getComputedStyle(node);
      if (
        s.outlineStyle !== 'none' &&
        parseFloat(s.outlineWidth) > 0 &&
        !transparent(s.outlineColor)
      )
        return true;
      if (s.boxShadow && s.boxShadow !== 'none') {
        // A painting layer has a colour that is not transparent and a length that is not zero.
        const colours = s.boxShadow.match(/rgba?\([^)]*\)/g) ?? [];
        const lengths = s.boxShadow
          .replace(/rgba?\([^)]*\)/g, '|')
          .split(',')
          .map((layer) => layer.match(/-?[\d.]+px/g) ?? [])
          .map((list) => list.map(parseFloat));
        return colours.some(
          (colour, i) =>
            !transparent(colour) && (lengths[i] ?? []).some((n) => n !== 0),
        );
      }
      return false;
    };

    const proxies: Element[] = [el];
    if (el instanceof HTMLInputElement) {
      const wrap = el.closest('label');
      if (wrap) proxies.push(wrap, ...Array.from(wrap.querySelectorAll('*')));
      if (el.labels) proxies.push(...Array.from(el.labels));
      if (el.parentElement)
        proxies.push(
          el.parentElement,
          ...Array.from(el.parentElement.children),
        );
    }
    const rect = el.getBoundingClientRect();
    const onScreen = rect.bottom > 0 && rect.top < innerHeight;
    const hit = document.elementFromPoint(
      Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1),
      Math.min(
        Math.max(rect.top + Math.min(rect.height / 2, 12), 0),
        innerHeight - 1,
      ),
    );
    const obscured =
      onScreen &&
      hit !== null &&
      !(el === hit || el.contains(hit) || hit.contains(el));
    const role = el.getAttribute('role');
    const name =
      el.getAttribute('aria-label') ??
      (el instanceof HTMLInputElement
        ? el.labels?.[0]?.innerText
        : undefined) ??
      (el as HTMLElement).innerText ??
      '';
    return {
      label: `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ''} "${name.trim().replace(/\s+/g, ' ').slice(0, 40)}"`,
      indicator: proxies.some(paints),
      obscured,
      offscreen: !onScreen,
      region: el.closest('[role=dialog]')
        ? ('dialog' as const)
        : el.closest('header, [role=banner]')
          ? ('banner' as const)
          : el.closest('main')
            ? ('main' as const)
            : el.closest('footer, [role=contentinfo]')
              ? ('contentinfo' as const)
              : ('other' as const),
    };
  });
}

export type TabWalk = {
  stops: TabStop[];
  /** True when focus left to the document or came back to a stop already seen. */
  completed: boolean;
};

/**
 * Presses Tab from the top of the page and records each stop until focus leaves to the document, returns to a stop
 * already seen, or `max` presses pass. A walk that reaches `max` without completing is a keyboard trap or a page
 * with more stops than `max`; the caller decides which.
 */
export async function walkTabOrder(page: Page, max = 250): Promise<TabWalk> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
    document
      .querySelectorAll('[data-a11y-seen]')
      .forEach((node) => node.removeAttribute('data-a11y-seen'));
  });
  const stops: TabStop[] = [];
  for (let index = 0; index < max; index += 1) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement)
        return 'end';
      if (el.hasAttribute('data-a11y-seen')) return 'repeat';
      el.setAttribute('data-a11y-seen', '1');
      return 'new';
    });
    if (state !== 'new') return {stops, completed: true};
    const info = await describeFocus(page);
    if (info) stops.push({index, ...info});
  }
  return {stops, completed: false};
}
