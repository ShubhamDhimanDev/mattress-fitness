import {Image} from '@shopify/hydrogen';
import {AdminLinkAction} from '~/components/home/AdminLinkAction';
import {buttonStyles} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {keyedText} from '~/lib/shopify/keys';
import type {BannerSection as BannerSectionData} from '~/lib/shopify/home-sections';

const FRAME: Record<BannerSectionData['type'], string> = {
  hero: 'on-dark mt-4 bg-primary-800 text-white md:px-12 md:py-16',
  'promo-banner': 'border-2 border-line bg-surface-muted text-fg',
  financing: 'bg-primary-50 text-fg',
};

type BannerSectionProps = {
  section: BannerSectionData;
  /** The page's single h1: the first hero with a heading. */
  asPageTitle: boolean;
};

/**
 * Hero, promo banner and financing block (REQ-HOME-001). All text, the image and the link come from the
 * `homepage_section` entry in Shopify admin; nothing is added here, so no price, term or promise appears
 * unless the client wrote it. Heading, text and image are each optional (the block adapts), and a link
 * without a label turns the heading into the link.
 */
export function BannerSection({section, asPageTitle}: BannerSectionProps) {
  const headingId = `${section.id}-heading`;
  const Heading = asPageTitle ? 'h1' : 'h2';
  const headingLink = section.link !== null && section.linkLabel === null;
  const hasImage = section.image !== null;

  return (
    <section
      aria-labelledby={section.heading ? headingId : undefined}
      className={cn(
        'my-6 rounded-panel px-6 py-8 md:my-8',
        FRAME[section.type],
        hasImage && 'grid items-center gap-6 md:grid-cols-2',
      )}
    >
      <div className="flex flex-col items-start gap-3">
        {section.heading ? (
          <Heading
            id={headingId}
            className={cn(
              'max-w-prose font-bold',
              section.type === 'hero'
                ? 'text-4xl leading-tight md:text-5xl'
                : 'text-2xl',
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
          </Heading>
        ) : null}
        {keyedText(section.body).map((paragraph) => (
          <p
            key={paragraph.key}
            className={cn(
              'max-w-prose',
              section.type === 'hero'
                ? 'text-lg text-primary-100'
                : 'text-base',
            )}
          >
            {paragraph.text}
          </p>
        ))}
        {section.link && section.linkLabel ? (
          <AdminLinkAction
            link={section.link}
            className={buttonStyles({
              variant: section.type === 'hero' ? 'accent' : 'primary',
              shape: 'pill',
              size: 'lg',
            })}
          >
            {section.linkLabel}
          </AdminLinkAction>
        ) : null}
      </div>
      {section.image ? (
        <Image
          data={section.image}
          // Decorative unless the client wrote alt text in admin; the heading carries the meaning.
          alt={section.image.altText ?? ''}
          aspectRatio="4/3"
          sizes="(min-width: 768px) 45vw, 100vw"
          loading={section.type === 'hero' ? 'eager' : 'lazy'}
          className="w-full rounded-card object-cover"
        />
      ) : null}
    </section>
  );
}
