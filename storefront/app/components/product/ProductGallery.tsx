import {Image} from '~/lib/hydrogen/image';
import {useRef, useState, type KeyboardEvent, type PointerEvent} from 'react';
import {ChevronRightIcon} from '~/components/ui/Icons';
import {cn} from '~/components/ui/cn';
import {boxRatio} from '~/lib/shopify/image-ratio';
import type {GalleryMedia, ImageView} from '~/lib/shopify/types';

/** The still picture of a slide: the photo itself, or the video's poster (null when it has none). */
function stillOf(item: GalleryMedia): ImageView | null {
  return item.kind === 'image' ? item.image : item.poster;
}

/** A small "play" triangle on a video's thumbnail. */
function PlayBadge() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-0 flex items-center justify-center"
    >
      <span className="flex size-8 items-center justify-center rounded-full bg-ink-900/80 text-white">
        <svg viewBox="0 0 24 24" className="ml-0.5 size-4 fill-current">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    </span>
  );
}

const SWIPE_DISTANCE = 40;
/** Pointer movement below this is a click, not a drag, so the slides do not twitch under a press on a button. */
const DRAG_THRESHOLD = 4;
/** At the first and last image a drag past the end only follows the finger this much. */
const END_RESISTANCE = 0.3;

function slideKey(item: GalleryMedia): string {
  return item.kind === 'image'
    ? item.image.url
    : (item.sources[0]?.url ?? 'video');
}

/**
 * Product gallery (REQ-PDP-001): photos and videos in the order Shopify admin has them (the first is the main image), with
 * previous and next buttons, thumbnails, arrow keys and swipe. A video slide plays in the page with the browser's own
 * controls; only the selected video slide holds a video element, so leaving it stops it, and nothing downloads a video before
 * it is chosen (`preload="metadata"`). The
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
  media,
  title,
  initialIndex = 0,
}: {
  media: readonly GalleryMedia[];
  title: string;
  initialIndex?: number;
}) {
  const [index, setIndex] = useState(
    Math.min(Math.max(initialIndex, 0), Math.max(media.length - 1, 0)),
  );
  const swipeStart = useRef<number | null>(null);
  // Horizontal offset of the strip while a finger or mouse drags it; null when nothing is dragging.
  const [drag, setDrag] = useState<number | null>(null);
  const count = media.length;
  const current = media[index];

  if (!current) {
    return (
      <div
        role="img"
        aria-label={`No image available for ${title}`}
        className="aspect-square w-full rounded-hero bg-surface-muted"
      />
    );
  }

  // The box takes the main photo's shape (between 3:4 and 3:2); every slide is drawn whole inside it, so nothing is cut off.
  const mainPhoto = media.find((item) => item.kind === 'image');
  const ratio = boxRatio(mainPhoto?.kind === 'image' ? mainPhoto.image : null);
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
        style={{aspectRatio: ratio}}
        className="relative touch-pan-y overflow-hidden rounded-hero border border-line bg-white"
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
          {media.map((item, position) => {
            const still = stillOf(item);
            return (
              <div
                key={slideKey(item)}
                aria-hidden={position === index ? undefined : true}
                className="size-full shrink-0"
              >
                {item.kind === 'video' && position === index ? (
                  // The poster is the still picture until the shopper presses play; the browser's controls are the keyboard path.
                  // The clip is a short product film, so it has no captions of its own to offer (it carries no speech).
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    controls
                    playsInline
                    preload="metadata"
                    poster={still?.url}
                    aria-label={item.alt || `${title} video`}
                    className="size-full bg-ink-900 object-contain"
                  >
                    {item.sources.map((source) => (
                      <source
                        key={source.url}
                        src={source.url}
                        type={source.mimeType}
                      />
                    ))}
                  </video>
                ) : still ? (
                  <Image
                    data={still}
                    alt={item.kind === 'image' ? (still.altText ?? title) : ''}
                    aspectRatio={String(ratio)}
                    sizes="(min-width: 1024px) 50vw, 100vw"
                    // Eager for all: an offscreen slide that is lazy would only start downloading when it is already sliding in.
                    loading="eager"
                    fetchPriority={position === firstIndex ? 'high' : 'low'}
                    draggable={false}
                    className="size-full object-contain select-none"
                  />
                ) : (
                  <div className="size-full bg-surface-muted" />
                )}
              </div>
            );
          })}
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
        {current.kind === 'video' ? 'Video' : 'Image'} {index + 1} of {count}
      </p>

      {count > 1 ? (
        // The strip scrolls (overflow clips), so it carries 6 px of padding for the 3 px focus ring plus its 2 px offset, and
        // the matching negative margin cancels it on every side, so the thumbnails keep their position. The old bottom padding
        // (pb-1) is gone, so the strip is 4 px shorter than before. scroll-px keeps that room when a focused thumbnail is
        // scrolled into view, so its ring is not clipped at the strip's edge (BV-002).
        <ul className="-m-1.5 flex scroll-px-1.5 gap-2 overflow-x-auto p-1.5">
          {media.map((item, position) => (
            <li key={slideKey(item)} className="shrink-0">
              <button
                type="button"
                aria-label={`Show ${item.kind === 'video' ? 'video' : 'image'} ${position + 1} of ${count}`}
                aria-current={position === index ? 'true' : undefined}
                onClick={() => setIndex(position)}
                className={cn(
                  'relative size-18 overflow-hidden rounded-choice border-2 bg-white',
                  position === index
                    ? 'border-primary-500'
                    : 'border-line hover:border-line-strong',
                )}
              >
                {stillOf(item) ? (
                  <Image
                    data={stillOf(item) as ImageView}
                    alt=""
                    aspectRatio="1/1"
                    sizes="72px"
                    loading="eager"
                    fetchPriority="low"
                    className="size-full object-contain"
                  />
                ) : null}
                {item.kind === 'video' ? <PlayBadge /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
