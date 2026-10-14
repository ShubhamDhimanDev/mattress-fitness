import {Image} from '@shopify/hydrogen';
import {keyedText} from '~/lib/shopify/keys';
import type {ImageView} from '~/lib/shopify/types';

type BrandHeaderProps = {
  name: string;
  logo: ImageView | null;
  about: readonly string[];
};

/**
 * Top of a brand page (REQ-COL-005): logo, name and the "about" text written in Shopify admin. The text is
 * plain paragraphs (the rich text is flattened server-side), so React escapes everything. Missing logo or
 * text simply leaves that part out.
 */
export function BrandHeader({name, logo, about}: BrandHeaderProps) {
  return (
    <header className="mt-2 flex flex-col gap-4 md:flex-row md:items-center md:gap-8">
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
      <div className="min-w-0">
        <h1 className="text-3xl font-bold">{name}</h1>
        {about.length > 0 ? (
          <div className="mt-2 flex max-w-prose flex-col gap-2 text-base text-fg-muted">
            {keyedText(about).map((paragraph) => (
              <p key={paragraph.key}>{paragraph.text}</p>
            ))}
          </div>
        ) : null}
      </div>
    </header>
  );
}
