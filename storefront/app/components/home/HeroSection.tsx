import {Link} from 'react-router';
import {AdminLinkAction} from '~/components/home/AdminLinkAction';
import {HighlightedText} from '~/components/home/HighlightedText';
import {HomeFinder} from '~/components/home/HomeFinder';
import {buttonStyles} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {TruckIcon} from '~/components/ui/Icons';
import {displayHeadingClass} from '~/lib/display-type';
import {Image} from '~/lib/hydrogen/image';
import {HOME_ASSURANCE_ITEMS} from '~/lib/navigation';
import type {AdminLink} from '~/lib/shopify/admin-link';
import {plainHeading} from '~/lib/shopify/home-highlight';
import type {HomeFinderData} from '~/lib/shopify/home-finder';
import {keyedText} from '~/lib/shopify/keys';
import type {ImageView} from '~/lib/shopify/types';

type HeroSectionProps = {
  id: string;
  heading: string | null;
  body: readonly string[];
  image: ImageView | null;
  link: AdminLink | null;
  linkLabel: string | null;
  finder: HomeFinderData | null;
  /** The page's single h1: the first hero with a heading. */
  asPageTitle: boolean;
};

/**
 * The home hero (REQ-HOME-001, CR-31): the heading with its `[[highlighted phrase]]`, the text, the optional button from
 * admin, the finder card and the large photo. Text, image and link come from the `homepage_section` entry; the finder
 * from the catalog. The floating delivery note on the photo appears only when its content exists in the project's config: it
 * needs a published delivery item (lib/navigation.ts). Without an image the copy and finder are one column.
 */
export function HeroSection({
  id,
  heading,
  body,
  image,
  link,
  linkLabel,
  finder,
  asPageTitle,
}: HeroSectionProps) {
  const headingId = `${id}-heading`;
  const Heading = asPageTitle ? 'h1' : 'h2';
  const headingLink = link !== null && linkLabel === null;
  const delivery = HOME_ASSURANCE_ITEMS.find((item) => item.id === 'delivery');

  return (
    <section
      aria-labelledby={heading ? headingId : undefined}
      className="rounded-hero bg-paper px-4 py-8 md:px-10 md:py-14"
    >
      <div
        className={cn(
          'grid gap-8 md:gap-12',
          image && 'lg:grid-cols-2 lg:items-center',
        )}
      >
        <div className="flex min-w-0 flex-col items-start gap-5">
          {heading ? (
            <Heading
              id={headingId}
              className={cn(
                displayHeadingClass(plainHeading(heading)),
                'text-hero text-balance md:text-display',
              )}
            >
              {link && headingLink ? (
                <AdminLinkAction link={link}>
                  <HighlightedText text={heading} />
                </AdminLinkAction>
              ) : (
                <HighlightedText text={heading} />
              )}
            </Heading>
          ) : null}
          {keyedText(body).map((paragraph) => (
            <p
              key={paragraph.key}
              className="max-w-prose text-lead text-fg-muted"
            >
              {paragraph.text}
            </p>
          ))}
          {link && linkLabel ? (
            <AdminLinkAction link={link} className={buttonStyles({size: 'lg'})}>
              {linkLabel}
            </AdminLinkAction>
          ) : null}
          {finder ? (
            <div className="mt-2 w-full max-w-2xl">
              <HomeFinder finder={finder} />
            </div>
          ) : null}
        </div>

        {image ? (
          <div className="relative">
            <Image
              data={image}
              // Decorative unless the client wrote alt text in admin; the heading carries the meaning.
              alt={image.altText ?? ''}
              aspectRatio="5/6"
              sizes="(min-width: 1024px) 45vw, 100vw"
              loading="eager"
              className="w-full rounded-hero object-cover"
            />
            {delivery ? (
              <Link
                to={delivery.to}
                className="absolute top-4 left-4 flex items-center gap-3 rounded-card bg-surface p-3 pr-4 font-bold text-fg shadow-lg"
              >
                <span
                  aria-hidden="true"
                  className="flex size-11 items-center justify-center rounded-choice bg-primary-500 text-white"
                >
                  <TruckIcon className="size-6" />
                </span>
                {delivery.text}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
