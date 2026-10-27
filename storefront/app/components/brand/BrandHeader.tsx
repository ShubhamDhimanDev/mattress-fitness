import {Image} from '~/lib/hydrogen/image';
import {cn} from '~/components/ui/cn';
import {displayHeadingClass} from '~/lib/display-type';
import {keyedText} from '~/lib/shopify/keys';
import type {ImageView} from '~/lib/shopify/types';

type BrandHeaderProps = {
  name: string;
  logo: ImageView | null;
  about: readonly string[];
  /**
   * The brand's own hero picture from admin, when the brand entry has one (CR-31). The `brand` definition has no such
   * field yet, so callers pass nothing today and the header is a clean paper band.
   */
  heroImage?: ImageView | null;
};

/**
 * Top of a brand page (REQ-COL-005, CR-31): a paper hero with the brand name as the page's h1, the logo when admin has one,
 * and the "about" text written in Shopify admin; with a hero image the picture sits beside the copy. The text is
 * plain paragraphs (the rich text is flattened server-side), so React escapes everything. Missing logo, image or
 * text simply leaves that part out.
 */
export function BrandHeader({
  name,
  logo,
  about,
  heroImage = null,
}: BrandHeaderProps) {
  return (
    <header
      className={cn(
        'mt-2 grid gap-6 rounded-hero bg-paper px-4 py-8 md:gap-10 md:px-10 md:py-12',
        heroImage && 'lg:grid-cols-2 lg:items-center',
      )}
    >
      <div className="flex min-w-0 flex-col items-start gap-4">
        {logo ? (
          <Image
            data={logo}
            // The brand name is the h1 beside it, so the logo adds nothing for a screen reader.
            alt=""
            sizes="(min-width: 768px) 200px, 160px"
            loading="eager"
            className="h-auto max-h-24 w-auto max-w-40 shrink-0 object-contain md:max-w-48"
          />
        ) : null}
        <h1
          className={cn(
            displayHeadingClass(name),
            'text-4xl text-balance md:text-5xl',
          )}
        >
          {name}
        </h1>
        {about.length > 0 ? (
          <div className="flex max-w-prose flex-col gap-2 text-lead text-fg-muted">
            {keyedText(about).map((paragraph) => (
              <p key={paragraph.key}>{paragraph.text}</p>
            ))}
          </div>
        ) : null}
      </div>
      {heroImage ? (
        <Image
          data={heroImage}
          alt={heroImage.altText ?? ''}
          aspectRatio="4/3"
          sizes="(min-width: 1024px) 45vw, 100vw"
          loading="eager"
          className="w-full rounded-hero object-cover"
        />
      ) : null}
    </header>
  );
}
