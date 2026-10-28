import {Image} from '~/lib/hydrogen/image';
import {AdminLinkAction} from '~/components/home/AdminLinkAction';
import {buttonStyles} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {displayHeadingClass} from '~/lib/display-type';
import type {PromoTileView, PromoTone} from '~/lib/shopify/promo-placement';

const SURFACE_BASE =
  'group flex h-full min-h-48 flex-col items-center justify-center gap-4 overflow-hidden rounded-card p-4 text-center md:p-6';

// Fixed class strings per known tone (never built from admin text). Red and dark carry `on-dark` so a focused tile draws
// the yellow ring, which the blue one would lose on them; the light tile keeps the default blue ring. White on
// primary-500 is 5.08:1; white on ink-900 and ink-900 on paper are higher. `overflow-hidden` rounds the image corners.
const TONE_STYLES: Record<
  PromoTone,
  {surface: string; imageBg: string; button: 'white' | 'primary'}
> = {
  red: {
    surface: 'on-dark bg-primary-500 text-white',
    imageBg: 'bg-primary-700',
    button: 'white',
  },
  dark: {
    surface: 'on-dark bg-ink-900 text-white',
    imageBg: 'bg-ink-800',
    button: 'white',
  },
  light: {
    surface: 'bg-paper text-fg border border-paper-line',
    imageBg: 'bg-paper-line',
    button: 'primary',
  },
};

/**
 * A promotional tile in the product grid (REQ-COL-003). It takes one grid cell, like a product card, and stretches
 * to the row's height. With a valid link the whole tile is one link named by its heading (the "Shop now" look-alike
 * button is part of that link, not a second control); without one it is plain content, never a dead link. The image
 * is decorative: the heading says what the tile is about. The colour comes from the optional `tone` field of the
 * promo-tile entry (red, dark or light; red when empty or unknown, CR31-13).
 */
export function PromoTileCard({tile}: {tile: PromoTileView}) {
  const tone = TONE_STYLES[tile.tone];
  const surface = cn(SURFACE_BASE, tone.surface);
  const body = (
    <>
      {tile.image ? (
        <div
          className={cn(
            'aspect-video w-full overflow-hidden rounded-choice md:aspect-square',
            tone.imageBg,
          )}
        >
          <Image
            data={tile.image}
            alt=""
            aspectRatio="1/1"
            sizes="(min-width: 1280px) 22vw, (min-width: 1024px) 30vw, 46vw"
            loading="lazy"
            className="size-full object-cover motion-safe:transition-transform motion-safe:group-hover:scale-105"
          />
        </div>
      ) : null}
      <span
        className={cn(
          displayHeadingClass(tile.heading),
          'text-title group-hover:underline',
        )}
      >
        {tile.heading}
      </span>
      {tile.link ? (
        <span className={buttonStyles({variant: tone.button, size: 'md'})}>
          Shop now
        </span>
      ) : null}
    </>
  );

  return tile.link ? (
    <AdminLinkAction link={tile.link} className={surface}>
      {body}
    </AdminLinkAction>
  ) : (
    <div className={surface}>{body}</div>
  );
}
