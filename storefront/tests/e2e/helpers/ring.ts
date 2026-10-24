import type {Locator, Page} from '@playwright/test';
import {describeFocus, type FocusInfo} from './a11y';

// Helpers for the brand restyle verification (BA-10). Measurements only: nothing here changes the page. The ring is
// the global 3 px outline with a 2 px offset (`tailwind.css`), so it is painted OUTSIDE the control, over whatever is
// behind the control. WCAG 1.4.11 / 2.4.11 therefore ask for 3 : 1 between the ring colour and that surrounding
// background, which is what `contrast` is.

export type RingInfo = FocusInfo & {
  ring: string;
  ringWidth: number;
  ringOffset: number;
  /** Colour behind the ring: the first ancestor with an opaque (or stacked) background, as rgb. */
  surround: string;
  /** True when a gradient or image sits behind the ring, so `contrast` is only a guess. */
  surroundIsImage: boolean;
  /**
   * Solid box-shadow band (spread only, no blur) that sits under the inner part of the ring, as rgb, or null. A
   * two-colour indicator (a dark band with a light ring over it, WCAG technique C40) is judged as a whole: the ring
   * must contrast with the band AND the band with the surround, see `contrast`.
   */
  band: string | null;
  /**
   * Contrast ratio, 2 decimals. Without a band: ring vs surround. With a band under the ring: the lower of ring vs
   * band and band vs the (worst) surround, because each boundary of the indicator has to be visible.
   */
  contrast: number;
  /** Ancestor that clips the ring (overflow not visible and the ring rect crosses its edge), with the sides. */
  clippedBy: string | null;
  /** True when the element that carries the ring is `position: fixed` (floats over unrelated content). */
  fixed: boolean;
  /** The rectangle the ring covers, in viewport CSS pixels (control box grown by offset plus width). */
  box: {left: number; top: number; right: number; bottom: number};
  /**
   * Worst contrast of the ring colour against the PAINTED pixels just outside the ring (a viewport screenshot read back
   * on a canvas), or null when it was not sampled. Taken for rings over a gradient or image (where the CSS colour model
   * is only a guess) and for fixed controls without a band. See `samplePaintedContrast`.
   */
  pixelContrast: number | null;
};

/** Measures the focus ring of the focused element (or, for a hidden native input, of its visible stand-in). */
export async function describeRing(page: Page): Promise<RingInfo | null> {
  // Buttons animate their outline colour for about 150 ms; measure the settled ring, not the first frame.
  await settle(page);
  const focus = await describeFocus(page);
  if (!focus) return null;
  const measured = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    if (!ctx) return null;
    // Any CSS colour syntax (oklch, color-mix, rgb) normalised to [r, g, b, a].
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 0) / 255];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r ?? 0) + 0.7152 * f(g ?? 0) + 0.0722 * f(b ?? 0);
    };
    const paints = (node: Element) => {
      const s = getComputedStyle(node);
      return (
        s.outlineStyle !== 'none' &&
        parseFloat(s.outlineWidth) > 0 &&
        rgba(s.outlineColor)[3] > 0
      );
    };
    const candidates: Element[] = [el];
    if (el instanceof HTMLInputElement) {
      const wrap = el.closest('label');
      if (wrap)
        candidates.push(wrap, ...Array.from(wrap.querySelectorAll('*')));
      if (el.labels) candidates.push(...Array.from(el.labels));
      if (el.parentElement)
        candidates.push(
          el.parentElement,
          ...Array.from(el.parentElement.children),
        );
    }
    const ringEl = (candidates.find(paints) ?? el) as HTMLElement;
    const style = getComputedStyle(ringEl);
    const ring = rgba(style.outlineColor);
    const ringWidth = parseFloat(style.outlineWidth) || 0;
    const ringOffset = parseFloat(style.outlineOffset) || 0;

    // Background behind a node: composite the node's and its ancestors' backgrounds until one is opaque.
    let isImage = false;
    const surfaceFrom = (start: Element | null): [number, number, number] => {
      let acc: [number, number, number] = [255, 255, 255];
      const layers: [number, number, number, number][] = [];
      for (let p = start; p; p = p.parentElement) {
        const ps = getComputedStyle(p);
        const c = rgba(ps.backgroundColor);
        if (ps.backgroundImage !== 'none') isImage = true;
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      for (const c of layers.reverse()) {
        acc = [
          c[0] * c[3] + acc[0] * (1 - c[3]),
          c[1] * c[3] + acc[1] * (1 - c[3]),
          c[2] * c[3] + acc[2] * (1 - c[3]),
        ];
      }
      return acc;
    };
    const ratio = (a: number[], b: number[]) => {
      const x = lum(a);
      const y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const over = (
      top: [number, number, number, number],
      under: number[],
    ): [number, number, number] => [
      top[0] * top[3] + (under[0] ?? 0) * (1 - top[3]),
      top[1] * top[3] + (under[1] ?? 0) * (1 - top[3]),
      top[2] * top[3] + (under[2] ?? 0) * (1 - top[3]),
    ];

    // Surfaces behind the ring. For most controls that is the ancestor chain. A position: fixed control (the skip
    // link) floats over unrelated content, so its DOM ancestors say nothing: sample what is actually painted just
    // outside the ring on all four sides and keep each, the worst one decides.
    const grow = ringOffset + ringWidth;
    const surfaces: [number, number, number][] = [];
    if (getComputedStyle(ringEl).position === 'fixed') {
      const box = ringEl.getBoundingClientRect();
      const gap = grow + 1;
      const points: [number, number][] = [
        [box.left - gap, (box.top + box.bottom) / 2],
        [box.right + gap, (box.top + box.bottom) / 2],
        [(box.left + box.right) / 2, box.top - gap],
        [(box.left + box.right) / 2, box.bottom + gap],
      ];
      for (const [x, y] of points) {
        if (x < 0 || y < 0) continue;
        const under = document
          .elementsFromPoint(x, y)
          .find((node) => node !== ringEl && !ringEl.contains(node));
        surfaces.push(surfaceFrom(under ?? document.body));
      }
    }
    if (surfaces.length === 0) surfaces.push(surfaceFrom(ringEl.parentElement));
    // Report the surface that gives the lowest ring contrast (the first when equal).
    const acc = surfaces.reduce((worst, s) =>
      ratio(over(ring, s), s) < ratio(over(ring, worst), worst) ? s : worst,
    );
    const ringOver = over(ring, acc);
    let contrast = ratio(ringOver, acc);

    // A solid, blur-free box-shadow band wider than the ring offset lies under the inner part of the ring (the
    // skip link: ink band, yellow ring). The ring then touches the band, and the band touches the surround. A band
    // counts only when it reaches (nearly) the ring's outer edge: spread >= offset + width - 1. A thinner shadow leaves
    // part of the ring (and a gap) on the bare surround, so it must not lift the judgement above ring vs surround.
    let band: [number, number, number] | null = null;
    const bandPattern =
      /(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(-?[\d.]+)px(?!\s+inset)/g;
    for (const m of style.boxShadow.matchAll(bandPattern)) {
      const colour = rgba(m[1] ?? '');
      const [dx, dy, blur, spread] = [m[2], m[3], m[4], m[5]].map((v) =>
        parseFloat(v ?? '0'),
      );
      if (dx !== 0 || dy !== 0 || blur !== 0) continue;
      if ((spread ?? 0) < ringOffset + ringWidth - 1 || colour[3] < 0.99)
        continue;
      band = [colour[0], colour[1], colour[2]];
      break;
    }
    if (band) {
      const bandContrasts = surfaces.map((s) => ratio(band as number[], s));
      contrast = Math.min(ratio(over(ring, band), band), ...bandContrasts);
    }

    // Clipping: any overflow-clipping ancestor whose box the ring rectangle crosses.
    const rect = ringEl.getBoundingClientRect();
    const ringRect = {
      left: rect.left - grow,
      right: rect.right + grow,
      top: rect.top - grow,
      bottom: rect.bottom + grow,
    };
    let clippedBy: string | null = null;
    for (
      let p = ringEl.parentElement;
      p && p !== document.body;
      p = p.parentElement
    ) {
      const ps = getComputedStyle(p);
      const clipX = ps.overflowX !== 'visible';
      const clipY = ps.overflowY !== 'visible';
      if (!clipX && !clipY) continue;
      const box = p.getBoundingClientRect();
      const sides: string[] = [];
      if (clipX && ringRect.left < box.left - 0.5) sides.push('left');
      if (clipX && ringRect.right > box.right + 0.5) sides.push('right');
      if (clipY && ringRect.top < box.top - 0.5) sides.push('top');
      if (clipY && ringRect.bottom > box.bottom + 0.5) sides.push('bottom');
      if (sides.length > 0) {
        clippedBy = `${p.tagName.toLowerCase()}.${p.className.toString().slice(0, 60)} (${sides.join('+')})`;
        break;
      }
    }
    const r = (v: number) => Math.round(v);
    return {
      ring: `rgb(${r(ring[0])},${r(ring[1])},${r(ring[2])})`,
      ringWidth,
      ringOffset,
      surround: `rgb(${r(acc[0])},${r(acc[1])},${r(acc[2])})`,
      surroundIsImage: isImage,
      band: band ? `rgb(${r(band[0])},${r(band[1])},${r(band[2])})` : null,
      contrast: Math.round(contrast * 100) / 100,
      clippedBy,
      fixed: style.position === 'fixed',
      box: {
        left: ringRect.left,
        top: ringRect.top,
        right: ringRect.right,
        bottom: ringRect.bottom,
      },
      pixelContrast: null,
    };
  });
  if (!measured) return null;
  return {...focus, ...measured};
}

/**
 * Contrast of the ring colour against what is really painted just outside the ring: a viewport screenshot (CSS pixel
 * scale) is decoded on a canvas and three 5 x 5 pixel blocks per side, 3 px beyond the ring rectangle, are averaged. The
 * worst block decides. Used where the CSS colour model cannot know the backdrop (a photo, a gradient, a fixed control).
 * Returns null when no sample point lies inside the viewport.
 */
export async function samplePaintedContrast(
  page: Page,
  ring: Pick<RingInfo, 'ring' | 'box'>,
): Promise<number | null> {
  const shot = await page.screenshot({scale: 'css', type: 'png'});
  return page.evaluate(
    async ({data, box, colour}) => {
      // createImageBitmap on a Blob, not an <img> with a data: URL: with analytics ids set the page's enforced
      // Content-Security-Policy names img-src without data:, so a data: image fails to decode ("EncodingError").
      const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
      const image = await createImageBitmap(
        new Blob([bytes], {type: 'image/png'}),
      );
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d', {willReadFrequently: true});
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0);
      const scale = image.width / document.documentElement.clientWidth;
      const lum = (r: number, g: number, b: number) => {
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ringRgb = (colour.match(/\d+/g) ?? ['0', '0', '0']).map(Number);
      const ringLum = lum(ringRgb[0] ?? 0, ringRgb[1] ?? 0, ringRgb[2] ?? 0);
      const gap = 3;
      const spanX = box.right - box.left;
      const spanY = box.bottom - box.top;
      const points: [number, number][] = [];
      for (const t of [0.25, 0.5, 0.75]) {
        points.push(
          [box.left - gap, box.top + spanY * t],
          [box.right + gap, box.top + spanY * t],
          [box.left + spanX * t, box.top - gap],
          [box.left + spanX * t, box.bottom + gap],
        );
      }
      let worst: number | null = null;
      for (const [x, y] of points) {
        const px = Math.round(x * scale) - 2;
        const py = Math.round(y * scale) - 2;
        if (px < 0 || py < 0 || px + 5 > canvas.width || py + 5 > canvas.height)
          continue;
        const d = ctx.getImageData(px, py, 5, 5).data;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < d.length; i += 4) {
          r += d[i] ?? 0;
          g += d[i + 1] ?? 0;
          b += d[i + 2] ?? 0;
        }
        const n = d.length / 4;
        const l = lum(r / n, g / n, b / n);
        const ratio =
          (Math.max(l, ringLum) + 0.05) / (Math.min(l, ringLum) + 0.05);
        if (worst === null || ratio < worst) worst = ratio;
      }
      return worst === null ? null : Math.round(worst * 100) / 100;
    },
    {data: shot.toString('base64'), box: ring.box, colour: ring.ring},
  );
}

export type RingStop = RingInfo & {index: number};

export type RingWalk = {
  stops: RingStop[];
  /**
   * True when focus left the document, or wrapped round to the FIRST stop (a closed loop through the whole page). False
   * when the walk hit `max` stops, or focus went back to a stop that was not the first (a keyboard trap), see `trap`.
   */
  completed: boolean;
  /** Describes the trap (which stop focus returned to, after which stop), or null. */
  trap: string | null;
};

/**
 * Tab through the page from the top, measuring each stop. Ends when focus leaves the document or wraps to the first stop
 * (completed), when it returns to any other stop already visited (a trap: A to B to C to B), or at `max` stops.
 */
export async function walkRings(page: Page, max = 250): Promise<RingWalk> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
    document
      .querySelectorAll('[data-ring-seen], [data-ring-first]')
      .forEach((node) => {
        node.removeAttribute('data-ring-seen');
        node.removeAttribute('data-ring-first');
      });
  });
  const stops: RingWalk['stops'] = [];
  for (let index = 0; index < max; index += 1) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement)
        return {kind: 'end' as const, label: ''};
      const label = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? (el as HTMLElement).innerText ?? '').trim().slice(0, 40)}"`;
      if (el.hasAttribute('data-ring-seen'))
        return {
          kind: el.hasAttribute('data-ring-first')
            ? ('wrap' as const)
            : ('repeat' as const),
          label,
        };
      el.setAttribute('data-ring-seen', '1');
      // The first element focused is the one a wrap-around has to come back to.
      if (!document.querySelector('[data-ring-first]'))
        el.setAttribute('data-ring-first', '1');
      return {kind: 'new' as const, label};
    });
    if (state.kind === 'end' || state.kind === 'wrap')
      return {stops, completed: true, trap: null};
    if (state.kind === 'repeat') {
      const previous = stops[stops.length - 1];
      return {
        stops,
        completed: false,
        trap: `Tab after stop #${previous?.index ?? '?'} (${previous?.label ?? 'none'}) returned to ${state.label}, a stop already visited that is not the first`,
      };
    }
    const info = await describeRing(page);
    if (info) {
      // Rings over a photo or gradient, and fixed controls without a band, are judged on painted pixels too.
      const pixels =
        info.surroundIsImage || (info.fixed && info.band === null)
          ? await samplePaintedContrast(page, info)
          : null;
      stops.push({index, ...info, pixelContrast: pixels});
    }
  }
  return {stops, completed: false, trap: null};
}

/** Stops whose ring sits over a gradient or image, where only the painted-pixel sample can say anything. */
export function stopsOverImages(stops: readonly RingStop[]): RingStop[] {
  return stops.filter((s) => s.surroundIsImage);
}

/** Stops that break the focus-visible expectations, as readable lines. */
export function ringProblems(
  stops: readonly RingStop[],
  minContrast = 3,
): string[] {
  const problems: string[] = [];
  for (const s of stops) {
    if (!s.indicator)
      problems.push(`#${s.index} ${s.label}: no painted focus indicator`);
    if (s.obscured)
      problems.push(`#${s.index} ${s.label}: obscured by another element`);
    if (s.clippedBy)
      problems.push(`#${s.index} ${s.label}: ring clipped by ${s.clippedBy}`);
    // Over an image the colour model is a guess, so only the painted pixels can fail the stop.
    if (s.indicator && !s.surroundIsImage && s.contrast < minContrast)
      problems.push(
        `#${s.index} ${s.label}: ring ${s.ring} on ${s.surround} is ${s.contrast}:1 (< ${minContrast})`,
      );
    if (
      s.indicator &&
      s.pixelContrast !== null &&
      s.pixelContrast < minContrast
    )
      problems.push(
        `#${s.index} ${s.label}: ring ${s.ring} on painted pixels is ${s.pixelContrast}:1 (< ${minContrast})`,
      );
  }
  return problems;
}

/**
 * Words that the browser has broken across two lines inside the matching elements (a word with no break opportunity that
 * a narrow box splits mid-word). Measured per word with a Range: two client rects on different lines mean a split.
 */
export async function midWordBreaks(scope: Locator): Promise<string[]> {
  return scope.evaluateAll((roots) => {
    const out: string[] = [];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? '';
        for (const m of text.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(n, m.index ?? 0);
          range.setEnd(n, (m.index ?? 0) + m[0].length);
          const rects = Array.from(range.getClientRects()).filter(
            (r) => r.width > 0,
          );
          const tops = new Set(rects.map((r) => Math.round(r.top / 4)));
          if (tops.size > 1) out.push(m[0]);
        }
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Reflow and spacing measurements (WCAG 1.4.10, 1.4.12), same rules as a11y-audit.spec.ts, plus the uppercase check.
// ---------------------------------------------------------------------------------------------------------------

export async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

/** Visible text or controls beyond the viewport edge that no scroll container explains. */
export async function contentOutsideViewport(page: Page): Promise<string[]> {
  await settle(page);
  return page.evaluate(() => {
    const out: string[] = [];
    const width = document.documentElement.clientWidth;
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!(el instanceof HTMLElement)) continue;
      if (
        !el.checkVisibility({
          checkVisibilityCSS: true,
          visibilityProperty: true,
        })
      )
        continue;
      if (el.closest('[inert], [aria-hidden=true]')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      const hasOwnText = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '',
      );
      if (!hasOwnText && !el.matches('a, button, input, select, textarea, img'))
        continue;
      if (rect.right <= width + 1 && rect.left >= -1) continue;
      let scrollable = false;
      for (
        let p = el.parentElement;
        p && p !== document.body;
        p = p.parentElement
      ) {
        const o = getComputedStyle(p).overflowX;
        if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) {
          scrollable = true;
          break;
        }
      }
      if (scrollable) continue;
      out.push(
        `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)} "${(el.innerText ?? '').trim().slice(0, 30)}" right=${Math.round(rect.right)} width=${width}`,
      );
    }
    return out.slice(0, 10);
  });
}

/** Elements that clip their own text (overflow hidden or clip with taller or wider content). Deliberate clamps excluded. */
export async function clippedContent(page: Page): Promise<string[]> {
  await settle(page);
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!(el instanceof HTMLElement)) continue;
      const s = getComputedStyle(el);
      const clipsY = s.overflowY === 'hidden' || s.overflowY === 'clip';
      const clipsX = s.overflowX === 'hidden' || s.overflowX === 'clip';
      if (!clipsY && !clipsX) continue;
      if (
        !el.checkVisibility({
          checkVisibilityCSS: true,
          visibilityProperty: true,
        })
      )
        continue;
      if (el.closest('[inert], [aria-hidden=true]')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      if ((el.innerText ?? '').trim() === '') continue;
      const clamp = s.getPropertyValue('-webkit-line-clamp');
      if (clamp && clamp !== 'none') continue;
      if (s.textOverflow === 'ellipsis') continue;
      const tooTall = clipsY && el.scrollHeight > el.clientHeight + 1;
      const tooWide = clipsX && el.scrollWidth > el.clientWidth + 1;
      if (tooTall || tooWide)
        out.push(
          `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 50)} "${(el.innerText ?? '').trim().slice(0, 30)}" scroll=${el.scrollWidth}x${el.scrollHeight} client=${el.clientWidth}x${el.clientHeight}`,
        );
    }
    return out.slice(0, 10);
  });
}

/** Line-clamped elements whose hidden lines exceed three (information a user may lose; reported, not gated). */
export async function lineClamped(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!(el instanceof HTMLElement)) continue;
      const clamp = getComputedStyle(el).getPropertyValue('-webkit-line-clamp');
      if (!clamp || clamp === 'none') continue;
      if (el.scrollHeight > el.clientHeight + 1)
        out.push(
          `"${(el.innerText ?? '').trim().slice(0, 40)}" clamp=${clamp}`,
        );
    }
    return out.slice(0, 10);
  });
}

/**
 * Uppercase text whose glyphs run wider than their own box (a long word that cannot break), measured with a Range
 * over the text so it also catches overflow that overflow-visible hides.
 */
export async function uppercaseOverflow(page: Page): Promise<string[]> {
  await settle(page);
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!(el instanceof HTMLElement)) continue;
      if (getComputedStyle(el).textTransform !== 'uppercase') continue;
      if (
        !el.checkVisibility({
          checkVisibilityCSS: true,
          visibilityProperty: true,
        })
      )
        continue;
      if (el.closest('[inert], [aria-hidden=true]')) continue;
      const hasOwnText = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '',
      );
      if (!hasOwnText) continue;
      let box: HTMLElement | null = el;
      while (box && getComputedStyle(box).display === 'inline')
        box = box.parentElement;
      if (!box) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const spacing = parseFloat(getComputedStyle(el).letterSpacing) || 0;
      // Border box (text may use the padding) and without the spacing painted after the last glyph.
      const innerRight = b.right;
      const innerLeft = b.left;
      if (
        text.width > 0 &&
        (text.right - spacing > innerRight + 1 || text.left < innerLeft - 1)
      )
        out.push(
          `${el.tagName.toLowerCase()} "${(el.innerText ?? '').trim().slice(0, 40)}" text ${Math.round(text.left)}..${Math.round(text.right)} box ${Math.round(innerLeft)}..${Math.round(innerRight)}`,
        );
    }
    return out.slice(0, 10);
  });
}
