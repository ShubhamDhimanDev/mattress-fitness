import {MoonIcon} from '~/components/ui/Icons';
import type {ProductImage} from '~/lib/catalog/types';

type ProductTileProps = {
  image: ProductImage | null;
  className?: string;
};

/**
 * Product picture with a fixed 4:3 box so nothing shifts while it loads. With no image (the preview
 * fixtures have none) it draws a neutral tile; the product name next to it carries the meaning, so the tile
 * is hidden from assistive technology.
 */
export function ProductTile({image, className = ''}: ProductTileProps) {
  return (
    <div
      className={`aspect-4/3 w-full overflow-hidden rounded-choice bg-surface-muted ${className}`}
    >
      {image ? (
        <img
          src={image.url}
          alt={image.altText ?? ''}
          width={image.width ?? undefined}
          height={image.height ?? undefined}
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex size-full items-center justify-center text-ink-400"
        >
          <MoonIcon className="size-12" />
        </div>
      )}
    </div>
  );
}
