import type {ImgHTMLAttributes} from 'react';

// `<Image>` for Shopify CDN images. Hydrogen 2026.10 no longer exports it; this follows the reference implementation in
// its `hydrogen-image` skill, reduced to what the project uses (ADR-0012): a plain `<img>` with a responsive `srcset`
// built with the CDN's `width` parameter, and the intrinsic width and height so the layout does not shift.

type ShopifyImageData = {
  url?: string | null;
  altText?: string | null;
  width?: number | null;
  height?: number | null;
  id?: string | null;
};

type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'srcSet'> & {
  data?: ShopifyImageData | null;
  /** A plain URL, when there is no image object. */
  src?: string;
  /** Widths for the srcset; defaults to a mobile-first ladder. */
  widths?: readonly number[];
  /** Aspect ratio as `w / h`, e.g. `1 / 1`; reserves the box. */
  aspectRatio?: string;
  /** Accepted and ignored: the old component could crop on the CDN. */
  crop?: string;
  loaderOptions?: unknown;
};

const DEFAULT_WIDTHS = [160, 320, 480, 640, 800, 1200] as const;

function withWidth(url: string, width: number): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('width', String(width));
    return parsed.toString();
  } catch {
    return url;
  }
}

export function Image({
  data,
  src,
  sizes,
  widths = DEFAULT_WIDTHS,
  aspectRatio,
  alt,
  style,
  loading = 'lazy',
  crop: _crop,
  loaderOptions: _loaderOptions,
  ...rest
}: ImageProps) {
  const url = data?.url ?? src;
  if (!url) return null;
  const srcSet = widths
    .filter((width) => !data?.width || width <= data.width * 2)
    .map((width) => `${withWidth(url, width)} ${width}w`)
    .join(', ');
  return (
    <img
      {...rest}
      src={url}
      srcSet={srcSet || undefined}
      sizes={sizes}
      alt={alt ?? data?.altText ?? ''}
      width={rest.width ?? data?.width ?? undefined}
      height={rest.height ?? data?.height ?? undefined}
      loading={loading}
      style={aspectRatio ? {aspectRatio, ...style} : style}
    />
  );
}
