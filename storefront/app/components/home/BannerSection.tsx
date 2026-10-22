import {Image} from '@shopify/hydrogen';
import {AdminLinkAction} from '~/components/home/AdminLinkAction';
import {buttonStyles, type ButtonVariant} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {displayHeadingClass} from '~/lib/display-type';
import {keyedText} from '~/lib/shopify/keys';
import type {BannerSection as BannerSectionData} from '~/lib/shopify/home-sections';

// The hero is a red band and the promo banner a black one: both carry `on-dark`, which turns the focus ring yellow
// (blue on red is 1.31:1). Text on a band is white only, never a tint (spec 5.4). Financing is a quiet grey panel.
const FRAME: Record<BannerSectionData['type'], string> = {
  hero: 'on-dark mt-4 bg-primary-500 px-6 py-12 text-white md:px-12 md:py-16',
  'promo-banner': 'on-dark bg-ink-900 px-6 py-8 text-white md:px-12 md:py-10',
  financing: 'bg-surface-muted px-6 py-8 text-fg md:px-12',
};

const ACTION: Record<BannerSectionData['type'], ButtonVariant> = {
  hero: 'inverse',
  'promo-banner': 'accent',
  financing: 'primary',
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
 * without a label turns the heading into the link. Without an image a hero is one centred column; with one it
 * is two columns, text on the left.
 */
export function BannerSection({section, asPageTitle}: BannerSectionProps) {
  const headingId = `${section.id}-heading`;
  const Heading = asPageTitle ? 'h1' : 'h2';
  const headingLink = section.link !== null && section.linkLabel === null;
  const hasImage = section.image !== null;
  const centred = section.type === 'hero' && !hasImage;

  return (
    <section
      aria-labelledby={section.heading ? headingId : undefined}
      className={cn(
        'my-6 rounded-panel md:my-8',
        FRAME[section.type],
        hasImage && 'grid items-center gap-6 md:grid-cols-2',
      )}
    >
      <div
        className={cn(
          'flex flex-col gap-3',
          centred ? 'items-center text-center' : 'items-start',
        )}
      >
        {section.heading ? (
          <Heading
            id={headingId}
            className={cn(
              'max-w-prose text-balance',
              section.type === 'hero'
                ? cn(
                    displayHeadingClass(section.heading),
                    'text-3xl sm:text-4xl md:text-5xl xl:text-display',
                  )
                : cn(displayHeadingClass(section.heading), 'text-2xl'),
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
              section.type === 'hero' ? 'text-lg' : 'text-base',
            )}
          >
            {paragraph.text}
          </p>
        ))}
        {section.link && section.linkLabel ? (
          <AdminLinkAction
            link={section.link}
            className={buttonStyles({
              variant: ACTION[section.type],
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
