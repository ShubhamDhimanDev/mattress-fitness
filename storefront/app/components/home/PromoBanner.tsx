import {Link} from 'react-router';
import {Button} from '~/components/ui/Button';
import {CheckIcon} from '~/components/ui/Icons';
import {PRIMARY_COLLECTION_HANDLE} from '~/lib/shopify/config';
import {brandOffersPath} from '~/lib/shopify/brand-path';

// The brands and promises of the sale, as the owner's banner artwork listed them (2026-11-03). Fixed in code: the sale
// is the client's own campaign and no Shopify content drives it. Each handle is that brand's page, `/brands/<handle>`
// (the seeded `brand` entries, scripts/setup/seed-entries.mjs); written out, not derived from the name, so a pill never
// points at a guessed address.
const SALE_BRANDS = [
  {name: 'Serta', handle: 'serta'},
  {name: 'Beautyrest', handle: 'beautyrest'},
  {name: 'Aireloom', handle: 'aireloom'},
  {name: 'Kingsdown', handle: 'kingsdown'},
  {name: 'Molecule', handle: 'molecule'},
  {name: 'Casper', handle: 'casper'},
  {name: 'Brooklyn Bedding', handle: 'brooklyn-bedding'},
  {name: 'Sealy', handle: 'sealy'},
  {name: 'Tempur-Pedic', handle: 'tempur-pedic'},
  {name: 'Helix', handle: 'helix'},
  {name: 'Stearns & Foster', handle: 'stearns-and-foster'},
] as const;

const SALE_PERKS = [
  '100% Comfort Guarantee',
  'Safe & Insured Delivery',
  '365 Night Sleep Trial',
] as const;

/**
 * The Black Friday sale banner at the top of the home page, above the hero (owner request 2026-11-03, rebuilt as live
 * markup the same day so the text is real, selectable and crisp). The owner dropped the "Limited time offer" label from
 * the artwork. It is a dark band with a red glow; the one action is "Shop now", to the mattresses.
 */
export function PromoBanner() {
  return (
    <section
      aria-labelledby="sale-banner-title"
      className="on-dark -mb-5 overflow-hidden rounded-hero md:-mb-12 bg-ink-900 bg-[radial-gradient(ellipse_at_top,var(--color-primary-900),var(--color-ink-900)_70%)] px-4 py-11 text-center text-white md:px-10 md:py-16"
    >
      <h2
        id="sale-banner-title"
        className="font-display text-4xl font-extrabold md:text-display"
      >
        Black Friday Sale
      </h2>
      <p className="mt-2 font-display text-2xl font-extrabold text-primary-400 md:text-4xl">
        Save Up to 70% Off*
      </p>

      <ul
        aria-label="Brands in the sale"
        className="mx-auto mt-6 flex max-w-4xl flex-wrap justify-center gap-2.5 md:mt-8"
      >
        {SALE_BRANDS.map((brand) => (
          <li key={brand.handle}>
            <Link
              to={brandOffersPath(brand.handle)}
              prefetch="intent"
              className="flex min-h-11 items-center rounded-pill border border-white/30 bg-white/10 px-4 text-sm font-semibold motion-safe:transition-colors hover:border-white hover:bg-white hover:text-ink-900"
            >
              {brand.name}
            </Link>
          </li>
        ))}
      </ul>

      <ul className="mx-auto mt-6 grid max-w-4xl gap-3 md:mt-8 md:grid-cols-3 md:gap-4">
        {SALE_PERKS.map((perk) => (
          <li
            key={perk}
            className="flex items-center justify-center gap-2.5 rounded-choice bg-white/10 px-3 py-4 font-display text-base font-bold"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-500">
              <CheckIcon className="size-4" />
            </span>
            {perk}
          </li>
        ))}
      </ul>

      <Button
        to={`/collections/${PRIMARY_COLLECTION_HANDLE}`}
        prefetch="intent"
        size="lg"
        className="mt-8"
      >
        Shop Now
      </Button>

      <p className="mt-6 text-caption text-white/70">*T&amp;C apply.</p>
    </section>
  );
}
