import {Link} from 'react-router';
import {SiteImage} from '~/components/ui/SiteImage';
import {brandPath} from '~/lib/shopify/brand-path';
import {SITE_IMAGES} from '~/lib/site-images';

// The Skechers by Serta banner under the Black Friday sale banner (owner request 2026-11-06). The owner's supplied artwork,
// shown whole and full width like the hero; its words (the partnership line, the store address and phone, "*T&C Apply") are
// part of the picture, so the alt text carries them. Fixed in code, like the sale banner: no Shopify content drives it.
//
// It goes to the Serta brand page ("powered by Serta innovation"): the store has no Skechers brand page or products, so
// there is nothing more specific to link to. Skechers and Serta marks appear in the artwork; the same open permission as the
// brand logos applies (docs/design/BRAND_TOKENS.md).

const ALT =
  'Mattress Fitness presents Skechers mattresses, powered by Serta innovation: a perfect partnership for everyday comfort. ' +
  '24324 Northwest Freeway, Suite 200, Cypress, TX 77429. Phone (281) 758-5279. Terms and conditions apply.';

export function PartnerBanner() {
  return (
    <section aria-label="Skechers by Serta">
      <Link
        to={brandPath('serta')}
        prefetch="intent"
        className="block overflow-hidden rounded-hero focus-visible:outline-offset-4"
      >
        <SiteImage
          image={SITE_IMAGES.partnerSkechers}
          aspectRatio="2 / 1"
          alt={ALT}
          sizes="(min-width: 1280px) 1280px, 100vw"
          className="h-auto w-full object-cover"
        />
        <span className="sr-only">Shop Serta</span>
      </Link>
    </section>
  );
}
