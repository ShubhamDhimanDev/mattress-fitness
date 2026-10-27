import {AdminLinkAction} from '~/components/home/AdminLinkAction';
import {buttonStyles} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {Image} from '~/lib/hydrogen/image';
import {displayHeadingClass} from '~/lib/display-type';
import {keyedText} from '~/lib/shopify/keys';
import type {BannerSection as BannerSectionData} from '~/lib/shopify/home-sections';

type BannerSectionProps = {section: BannerSectionData};

/**
 * The financing block (REQ-HOME-001): a quiet paper panel with the heading, text, optional image and link from the
 * `homepage_section` entry in Shopify admin. Nothing is added here, so no price, term or promise appears unless the
 * client wrote it. The hero has its own component (HeroSection) and promo banners are the cards of OfferCards. Heading,
 * text and image are each optional, and a link without a label turns the heading into the link.
 */
export function BannerSection({section}: BannerSectionProps) {
  const headingId = `${section.id}-heading`;
  const headingLink = section.link !== null && section.linkLabel === null;

  return (
    <section
      aria-labelledby={section.heading ? headingId : undefined}
      className={cn(
        'rounded-panel border border-line bg-paper px-4 py-8 md:px-12 md:py-10',
        section.image && 'grid items-center gap-6 md:grid-cols-2',
      )}
    >
      <div className="flex flex-col items-start gap-3">
        {section.heading ? (
          <h2
            id={headingId}
            className={cn(
              displayHeadingClass(section.heading),
              'max-w-prose text-2xl text-balance md:text-3xl',
            )}
          >
            {section.link && headingLink ? (
              <AdminLinkAction
                link={section.link}
                className="underline underline-offset-4 hover:no-underline"
              >
                {section.heading}
              </AdminLinkAction>
            ) : (
              section.heading
            )}
          </h2>
        ) : null}
        {keyedText(section.body).map((paragraph) => (
          <p key={paragraph.key} className="max-w-prose text-base">
            {paragraph.text}
          </p>
        ))}
        {section.link && section.linkLabel ? (
          <AdminLinkAction
            link={section.link}
            className={buttonStyles({size: 'lg'})}
          >
            {section.linkLabel}
          </AdminLinkAction>
        ) : null}
      </div>
      {section.image ? (
        <Image
          data={section.image}
          alt={section.image.altText ?? ''}
          aspectRatio="4/3"
          sizes="(min-width: 768px) 45vw, 100vw"
          loading="lazy"
          className="w-full rounded-card object-cover"
        />
      ) : null}
    </section>
  );
}
