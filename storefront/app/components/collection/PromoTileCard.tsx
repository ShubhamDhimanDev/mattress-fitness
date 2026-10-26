import {Image} from '~/lib/hydrogen/image';
import {AdminLinkAction} from '~/components/home/AdminLinkAction';
import {buttonStyles} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {displayHeadingClass} from '~/lib/display-type';
import type {PromoTileView} from '~/lib/shopify/promo-placement';

const SURFACE =
  'group flex h-full min-h-48 flex-col items-center justify-center gap-3 rounded-card bg-surface-muted p-4 text-center';

/**
 * A promotional tile in the product grid (REQ-COL-003). It takes one grid cell, like a product card, and stretches
 * to the row's height. With a valid link the whole tile is one link named by its heading (the "Shop now" look-alike
 * button is part of that link, not a second control); without one it is plain content, never a dead link. The image
 * is decorative: the heading says what the tile is about. Every tile is grey: a red tile needs a tone field in the
 * promo-tile metaobject that does not exist yet (BRAND_APPLICATION_SPEC 5.5).
 */
export function PromoTileCard({tile}: {tile: PromoTileView}) {
  const body = (
    <>
      {tile.image ? (
        <div className="aspect-video w-full overflow-hidden rounded-choice bg-surface md:aspect-square">
          <Image
            data={tile.image}
            alt=""
            aspectRatio="1/1"
            sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 92vw"
            loading="lazy"
            className="size-full object-cover motion-safe:transition-transform motion-safe:group-hover:scale-105"
          />
        </div>
      ) : null}
      <span
        className={cn(
          displayHeadingClass(tile.heading),
          'text-xl text-fg group-hover:underline',
        )}
      >
        {tile.heading}
      </span>
      {tile.link ? (
        <span className={buttonStyles({variant: 'primary', size: 'md'})}>
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
