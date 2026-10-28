import {Image} from '~/lib/hydrogen/image';
import {useRef, useState, type KeyboardEvent, type PointerEvent} from 'react';
import {ChevronRightIcon} from '~/components/ui/Icons';
import {cn} from '~/components/ui/cn';
import type {ImageView} from '~/lib/shopify/types';

const SWIPE_DISTANCE = 40;
/** Pointer movement below this is a click, not a drag, so the slides do not twitch under a press on a button. */
const DRAG_THRESHOLD = 4;
/** At the first and last image a drag past the end only follows the finger this much. */
const END_RESISTANCE = 0.3;

/**
 * Product image gallery (REQ-PDP-001): previous and next buttons, thumbnails, arrow keys and swipe. The
 * large image sits in a square box so nothing shifts while it loads; alt text is the catalog's, falling
 * back to the product title. The parent gives it a `key` per selected variant image to jump to that image.
 *
 * The images are slides in one strip that slides sideways to the chosen one, and follows the finger while it
 * drags. The slide is a transform transition inside `motion-safe:`, so with reduced motion the image just
 * changes. Every slide is in the page from the start, so a click never waits for a download: the selected image
 * loads first (high priority) and the rest at low priority behind it. Only the selected slide is exposed to
 * assistive technology.
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
  // Horizontal offset of the strip while a finger or mouse drags it; null when nothing is dragging.
  const [drag, setDrag] = useState<number | null>(null);
  const count = images.length;
  const current = images[index];

  if (!current) {
    return (
      <div
        role="img"
        aria-label={`No image available for ${title}`}
        className="aspect-square w-full rounded-hero bg-surface-muted"
      />
    );
  }

  const go = (next: number) => setIndex((next + count) % count);
  const firstIndex = Math.min(Math.max(initialIndex, 0), count - 1);

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

  function onPointerMove(event: PointerEvent) {
    const start = swipeStart.current;
    if (start === null || count < 2) return;
    const delta = event.clientX - start;
    if (Math.abs(delta) < DRAG_THRESHOLD && drag === null) return;
    const pastEnd =
      (index === 0 && delta > 0) || (index === count - 1 && delta < 0);
    setDrag(pastEnd ? delta * END_RESISTANCE : delta);
  }

  function finishDrag(event: PointerEvent) {
    const start = swipeStart.current;
    swipeStart.current = null;
    setDrag(null);
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
      // min-w-0: this section is a grid item, whose automatic minimum width is its content's. Without it five or more
      // thumbnails widen the column and the page scrolls sideways at 360 px (BV-014, WCAG 1.4.10); with it the strip scrolls
      // inside its own box.
      className="flex min-w-0 flex-col gap-3"
    >
      <div
        className="relative aspect-square touch-pan-y overflow-hidden rounded-hero border border-line bg-surface-muted"
        onPointerDown={(event) => {
          swipeStart.current = event.clientX;
        }}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerLeave={(event) => {
          if (swipeStart.current !== null) finishDrag(event);
        }}
        onPointerCancel={() => {
          swipeStart.current = null;
          setDrag(null);
        }}
      >
        <div
          className={cn(
            'flex size-full',
            // No transition while the strip follows the pointer, or it would lag behind it.
            drag === null &&
              'motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out',
          )}
          style={{
            transform: `translateX(calc(${-index * 100}% + ${drag ?? 0}px))`,
          }}
        >
          {images.map((image, position) => (
            <div
              key={image.url}
              aria-hidden={position === index ? undefined : true}
              className="size-full shrink-0"
            >
              <Image
                data={image}
                alt={image.altText ?? title}
                aspectRatio="1/1"
                sizes="(min-width: 1024px) 50vw, 100vw"
                // Eager for all: an offscreen slide that is lazy would only start downloading when it is already sliding in.
                loading="eager"
                fetchPriority={position === firstIndex ? 'high' : 'low'}
                draggable={false}
                className="size-full object-cover select-none"
              />
            </div>
          ))}
        </div>
        {count > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => go(index - 1)}
              className="absolute top-1/2 left-3 inline-flex size-touch -translate-y-1/2 items-center justify-center rounded-pill bg-surface text-fg shadow-md hover:bg-surface-muted"
            >
              <ChevronRightIcon className="size-5 rotate-180" />
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={() => go(index + 1)}
              className="absolute top-1/2 right-3 inline-flex size-touch -translate-y-1/2 items-center justify-center rounded-pill bg-surface text-fg shadow-md hover:bg-surface-muted"
            >
              <ChevronRightIcon className="size-5" />
            </button>
            <p className="absolute right-3 bottom-3 rounded-pill bg-ink-900 px-3 py-1 text-caption font-bold text-white">
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
                  'size-18 overflow-hidden rounded-choice border-2 bg-surface-muted',
                  position === index
                    ? 'border-primary-500'
                    : 'border-line hover:border-line-strong',
                )}
              >
                <Image
                  data={image}
                  alt=""
                  aspectRatio="1/1"
                  sizes="72px"
                  loading="eager"
                  fetchPriority="low"
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
