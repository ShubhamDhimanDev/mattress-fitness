import {Link} from 'react-router';
import {SiteImage} from '~/components/ui/SiteImage';
import {SITE_IMAGES} from '~/lib/site-images';
import {PRIMARY_COLLECTION_HANDLE} from '~/lib/shopify/config';

// The wording of the picture, for screen readers and for when the image does not load. Keep it in step with the artwork.
const BANNER_ALT =
  'Mattress Fitness Black Friday sale: save up to 70% off on Serta, Beautyrest, Aireloom, Molecule, Casper, Brooklyn Bedding, Sealy, Tempur-Pedic, Helix and Stearns & Foster. 100% comfort guarantee, safe and insured delivery, 365 night sleep trial. Terms and conditions apply. Shop now.';

/**
 * The Black Friday sale banner at the top of the home page, above the hero (owner request 2026-11-03). The picture is a
 * finished design from the client with its text inside it, so the alt text carries that text. The whole banner is one
 * link to the mattresses, as its "Shop now" button says. It is the first thing on the page, so it loads eagerly.
 */
export function PromoBanner() {
  return (
    <section aria-label="Black Friday sale">
      <Link
        to={`/collections/${PRIMARY_COLLECTION_HANDLE}`}
        prefetch="intent"
        className="block overflow-hidden rounded-hero"
      >
        <SiteImage
          image={SITE_IMAGES.blackFridayBanner}
          alt={BANNER_ALT}
          sizes="100vw"
          aspectRatio="1600 / 639"
          loading="eager"
          fetchPriority="high"
          className="h-auto w-full"
        />
      </Link>
    </section>
  );
}
