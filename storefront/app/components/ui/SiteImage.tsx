import type {SiteImage as SiteImageData} from '~/lib/site-images';

type SiteImageProps = {
  image: SiteImageData;
  sizes: string;
  /** Aspect ratio as `w / h`; the picture is cropped to it with `object-cover`. */
  aspectRatio: string;
  loading?: 'eager' | 'lazy';
  /** Empty for a decorative photograph; set it for a picture that carries text. */
  alt?: string;
  fetchPriority?: 'high' | 'auto';
  className?: string;
};

/**
 * One of the photographs bundled in `public/images/` (lib/site-images.ts). Unlike `Image` it does not build CDN width
 * URLs: the two exported widths are the whole ladder. Decorative unless an `alt` is passed.
 */
export function SiteImage({
  image,
  sizes,
  aspectRatio,
  loading = 'lazy',
  alt = '',
  fetchPriority,
  className,
}: SiteImageProps) {
  return (
    <img
      src={image.src}
      srcSet={image.srcSet}
      sizes={sizes}
      alt={alt}
      width={image.width}
      height={image.height}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      style={{aspectRatio}}
      className={className}
    />
  );
}
