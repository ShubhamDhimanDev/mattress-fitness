import {Image} from '~/lib/hydrogen/image';
import {AdminLinkAction} from '~/components/home/AdminLinkAction';
import {buttonStyles} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {displayHeadingClass} from '~/lib/display-type';
import type {PromoTileView} from '~/lib/shopify/promo-placement';

// A solid brand-red card with white text (white on primary-500 is 5.08:1). The band carries `on-dark` so a focused tile
// draws the yellow ring, which the blue one would lose on red. `overflow-hidden` rounds the image corners.
const SURFACE =
  'on-dark group flex h-full min-h-48 flex-col items-center justify-center gap-4 overflow-hidden rounded-card bg-primary-500 p-4 text-center text-white md:p-6';

/**
 * A promotional tile in the product grid (REQ-COL-003). It takes one grid cell, like a product card, and stretches
 * to the row's height. With a valid link the whole tile is one link named by its heading (the "Shop now" look-alike
 * button is part of that link, not a second control); without one it is plain content, never a dead link. The image
 * is decorative: the heading says what the tile is about. Every tile is the same solid red: a second colour would need a
 * tone field in the promo-tile metaobject, which does not exist yet (BRAND_APPLICATION_SPEC 5.5).
 */
export function PromoTileCard({tile}: {tile: PromoTileView}) {
  const body = (
    <>
      {tile.image ? (
        <div className="aspect-video w-full overflow-hidden rounded-choice bg-primary-700 md:aspect-square">
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
        <span className={buttonStyles({variant: 'white', size: 'md'})}>
          Shop now
        </span>
      ) : null}
    </>
  );

  return tile.link ? (
    <AdminLinkAction link={tile.link} className={SURFACE}>
      {body}
    </AdminLinkAction>
  ) : (
    <div className={SURFACE}>{body}</div>
  );
}
