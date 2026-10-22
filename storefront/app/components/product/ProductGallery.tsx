import {Image} from '@shopify/hydrogen';
import {useRef, useState, type KeyboardEvent, type PointerEvent} from 'react';
import {ChevronRightIcon} from '~/components/ui/Icons';
import {cn} from '~/components/ui/cn';
import type {ImageView} from '~/lib/shopify/types';

const SWIPE_DISTANCE = 40;

/**
 * Product image gallery (REQ-PDP-001): previous and next buttons, thumbnails, arrow keys and swipe. The
 * large image sits in a square box so nothing shifts while it loads; alt text is the catalog's, falling
 * back to the product title. The parent gives it a `key` per selected variant image to jump to that image.
 */
export function ProductGallery({
  images,
  title,
  initialIndex = 0,
}: {
  images: readonly ImageView[];
  title: string;
  initialIndex?: number;
}) {
  const [index, setIndex] = useState(
    Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)),
  );
  const swipeStart = useRef<number | null>(null);
  const count = images.length;
  const current = images[index];

  if (!current) {
    return (
      <div
        role="img"
        aria-label={`No image available for ${title}`}
        className="aspect-square w-full rounded-card bg-surface-muted"
      />
    );
  }

  const go = (next: number) => setIndex((next + count) % count);

  function onKeyDown(event: KeyboardEvent) {
    if (count < 2) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(index + 1);
    }
  }

  function onPointerUp(event: PointerEvent) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (start === null || count < 2) return;
    const delta = event.clientX - start;
    if (Math.abs(delta) >= SWIPE_DISTANCE)
      go(delta < 0 ? index + 1 : index - 1);
  }

  return (
    // Arrow keys are a shortcut only; every control inside is a real button, so the region needs no role.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      aria-roledescription="carousel"
      aria-label={`${title} images`}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3"
    >
      <div
        className="relative aspect-square touch-pan-y overflow-hidden rounded-card bg-surface-muted"
        onPointerDown={(event) => {
          swipeStart.current = event.clientX;
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipeStart.current = null;
        }}
      >
        <Image
          key={current.url}
          data={current}
          alt={current.altText ?? title}
          aspectRatio="1/1"
          sizes="(min-width: 1024px) 50vw, 100vw"
          loading="eager"
          className="size-full object-cover"
        />
        {count > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => go(index - 1)}
              className="absolute top-1/2 left-2 inline-flex size-touch -translate-y-1/2 items-center justify-center rounded-pill bg-surface text-fg shadow-md hover:bg-surface-muted"
            >
              <ChevronRightIcon className="size-5 rotate-180" />
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={() => go(index + 1)}
              className="absolute top-1/2 right-2 inline-flex size-touch -translate-y-1/2 items-center justify-center rounded-pill bg-surface text-fg shadow-md hover:bg-surface-muted"
            >
              <ChevronRightIcon className="size-5" />
            </button>
            <p className="absolute right-2 bottom-2 rounded-choice bg-ink-900 px-2 py-1 text-xs font-bold text-white">
              {index + 1} / {count}
            </p>
          </>
        ) : null}
      </div>
      <p role="status" className="sr-only">
        Image {index + 1} of {count}
      </p>

      {count > 1 ? (
        // The strip scrolls (overflow clips), so it carries 6 px of padding for the 3 px focus ring plus its 2 px offset, and
        // the matching negative margin cancels it on every side, so the thumbnails keep their position. The old bottom padding
        // (pb-1) is gone, so the strip is 4 px shorter than before. scroll-px keeps that room when a focused thumbnail is
        // scrolled into view, so its ring is not clipped at the strip's edge (BV-002).
        <ul className="-m-1.5 flex scroll-px-1.5 gap-2 overflow-x-auto p-1.5">
          {images.map((image, position) => (
            <li key={image.url} className="shrink-0">
              <button
                type="button"
                aria-label={`Show image ${position + 1} of ${count}`}
                aria-current={position === index ? 'true' : undefined}
                onClick={() => setIndex(position)}
                className={cn(
                  'size-16 overflow-hidden rounded-choice border-2 bg-surface-muted',
                  position === index
                    ? 'border-primary-500'
                    : 'border-line hover:border-line-strong',
                )}
              >
                <Image
                  data={image}
                  alt=""
                  aspectRatio="1/1"
                  sizes="64px"
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
