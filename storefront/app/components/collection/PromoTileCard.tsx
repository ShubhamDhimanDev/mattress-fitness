import {Image} from '@shopify/hydrogen';
import {AdminLinkAction} from '~/components/home/AdminLinkAction';
import type {PromoTileView} from '~/lib/shopify/promo-placement';

/**
 * A promotional tile in the product grid (REQ-COL-003). It takes one grid cell, like a product card. With a
 * valid link the whole tile is one link named by its heading; without one it is plain content, never a dead
 * link. The image is decorative: the heading says what the tile is about.
 */
export function PromoTileCard({tile}: {tile: PromoTileView}) {
  const body = (
    <>
      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-card bg-primary-50">
        {tile.image ? (
          <Image
            data={tile.image}
            alt=""
            aspectRatio="1/1"
            sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw"
            loading="lazy"
            className="size-full object-cover motion-safe:transition-transform motion-safe:group-hover:scale-105"
          />
        ) : (
          <span className="px-4 text-center text-xl font-bold text-primary-800">
            {tile.heading}
          </span>
        )}
      </div>
      {tile.image ? (
        <span className="text-base font-bold text-fg group-hover:underline">
          {tile.heading}
        </span>
      ) : null}
    </>
  );

  return (
    <div className="group flex h-full flex-col gap-2">
      {tile.link ? (
        <AdminLinkAction link={tile.link} className="flex flex-col gap-2">
          {body}
        </AdminLinkAction>
      ) : (
        body
      )}
    </div>
  );
}
