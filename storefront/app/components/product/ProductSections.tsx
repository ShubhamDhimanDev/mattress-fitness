import {Image} from '~/lib/hydrogen/image';
import {Link} from 'react-router';
import {keyedText} from '~/lib/shopify/keys';
import {ReviewsSlot} from '~/components/reviews/ReviewsSlot';
import {Card} from '~/components/ui/Card';
import {CheckIcon} from '~/components/ui/Icons';
import {Accordion, type AccordionPanelItem} from '~/components/ui/Accordion';
import type {BrandLink} from '~/lib/shopify/brand-link';
import {splitSpecifications} from '~/lib/shopify/spec-tiles';
import type {ProductPageView} from '~/lib/shopify/types';

/**
 * Specification tiles and features beside the overview, then accordions for the brand and its warranty, then FAQs
 * (REQ-PDP-002, BA-08). Each section is rendered only when it has data, so a product without metafields shows just its
 * description. All text is plain (see lib/shopify/rich-text.ts); nothing from the admin is inserted as HTML. Collapsed
 * accordion rows keep their content in the HTML (`hidden`), so crawlers see it, and they use `hidden="until-found"`
 * once scripts run (`findInPage`), so the browser's find-in-page matches the text and opens the row.
 *
 * There is no "Delivery and shipping" row yet: its wording has to come from the client (B-15, UXD-16), and the
 * ZIP-based delivery promise already sits in the buy box (DeliveryCheck).
 */
export function ProductSections({
  product,
  brandLink = null,
  reviews = false,
}: {
  product: ProductPageView;
  /** The brand's page, when one exists; adds a link in the brand section. */
  brandLink?: BrandLink | null;
  /** The loader says a reviews provider is configured (REQ-PDP-005). False renders nothing and requests nothing. */
  reviews?: boolean;
}) {
  const {tiles, rows} = splitSpecifications(product);
  const hasOverview = product.description.length > 0;
  const hasSpecs = tiles.length > 0 || rows.length > 0;
  const hasFeatures = product.features.length > 0;
  const brand = product.brand;
  const brandRows: AccordionPanelItem[] = [];
  if (brand && brand.about.length > 0) {
    brandRows.push({
      id: 'brand',
      title: `About ${brand.name}`,
      content: (
        <div className="flex flex-col gap-3">
          {brand.logo ? (
            <Image
              data={brand.logo}
              alt={brand.logo.altText ?? brand.name}
              sizes="160px"
              className="h-auto max-h-16 w-auto self-start"
            />
          ) : null}
          <div className="flex max-w-prose flex-col gap-3 text-base">
            {keyedText(brand.about).map((paragraph) => (
              <p key={paragraph.key}>{paragraph.text}</p>
            ))}
          </div>
          {brandLink ? (
            <Link
              to={brandLink.to}
              prefetch="intent"
              className="inline-flex min-h-touch w-fit items-center font-bold text-primary-700 underline underline-offset-4 hover:text-primary-800"
            >
              See all {brandLink.name} products
            </Link>
          ) : null}
        </div>
      ),
    });
  }
  if (brand && brand.warranty.length > 0) {
    brandRows.push({
      id: 'warranty',
      title: 'Warranty',
      content: (
        <div className="flex max-w-prose flex-col gap-3 text-base">
          {keyedText(brand.warranty).map((paragraph) => (
            <p key={paragraph.key}>{paragraph.text}</p>
          ))}
        </div>
      ),
    });
  }

  return (
    <div className="mt-12 flex flex-col gap-12 md:mt-16 md:gap-16">
      {hasOverview || hasSpecs || hasFeatures ? (
        // The overview comes first in the HTML (a phone shopper reads it first). From lg the specification column sits on
        // the left and the overview on the right, placed by the grid and not by reordering the markup.
        <div className="grid gap-10 lg:grid-cols-3">
          {hasOverview ? (
            <section
              aria-labelledby="pdp-overview-heading"
              className={
                hasSpecs || hasFeatures
                  ? 'lg:col-span-2 lg:col-start-2 lg:row-start-1'
                  : 'lg:col-span-3'
              }
            >
              <h2
                id="pdp-overview-heading"
                className="type-display mb-4 text-2xl md:text-3xl"
              >
                Overview
              </h2>
              <div className="flex max-w-prose flex-col gap-3 text-base">
                {keyedText(product.description).map((paragraph) => (
                  <p key={paragraph.key}>{paragraph.text}</p>
                ))}
              </div>
            </section>
          ) : null}

          {hasSpecs || hasFeatures ? (
            <div className="flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-1">
              {hasSpecs ? (
                <section aria-labelledby="pdp-specs-heading">
                  <h2
                    id="pdp-specs-heading"
                    className="type-display mb-4 text-2xl md:text-3xl"
                  >
                    Specifications
                  </h2>
                  {tiles.length > 0 ? (
                    <dl className="mb-4 grid grid-cols-2 gap-3">
                      {tiles.map((tile) => (
                        <div
                          key={tile.label}
                          className="flex flex-col items-center justify-center gap-1 rounded-card bg-paper p-4 text-center"
                        >
                          <dt className="text-caption font-bold tracking-wide text-fg-muted uppercase">
                            {tile.label}
                          </dt>
                          <dd className="text-lg font-extrabold break-words">
                            {tile.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {rows.length > 0 ? (
                    <div className="overflow-hidden rounded-card border border-line">
                      <table className="w-full border-collapse text-left text-base">
                        <tbody>
                          {rows.map((row) => (
                            <tr
                              key={row.label}
                              className="border-b border-line last:border-b-0"
                            >
                              <th
                                scope="row"
                                className="w-2/5 bg-paper px-4 py-3 font-bold"
                              >
                                {row.label}
                              </th>
                              <td className="px-4 py-3">{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {hasFeatures ? (
                <section aria-labelledby="pdp-features-heading">
                  <h2
                    id="pdp-features-heading"
                    className="type-display mb-4 text-2xl md:text-3xl"
                  >
                    Features
                  </h2>
                  <ul className="flex flex-col gap-3 text-base">
                    {product.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <CheckIcon className="mt-0.5 size-5 shrink-0 text-success-fg" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {brandRows.length > 0 ? (
        <section aria-labelledby="pdp-brand-heading">
          {/* The accordion triggers are h3: this heading gives them an h2 parent in the outline. */}
          <h2 id="pdp-brand-heading" className="sr-only">
            About the brand and warranty
          </h2>
          <Card padding="none" className="px-4 md:px-6">
            <Accordion
              type="multiple"
              headingLevel={3}
              findInPage
              items={brandRows}
            />
          </Card>
        </section>
      ) : null}

      {product.faqs.length > 0 ? (
        <section aria-labelledby="pdp-faq-heading">
          <h2
            id="pdp-faq-heading"
            className="type-display mb-4 text-2xl md:text-3xl"
          >
            Frequently asked questions
          </h2>
          <Card padding="none" className="px-4 md:px-6">
            <Accordion
              type="multiple"
              headingLevel={3}
              findInPage
              items={product.faqs.map((faq) => ({
                id: faq.id,
                title: faq.question,
                content: (
                  <div className="flex max-w-prose flex-col gap-2">
                    {keyedText(faq.answer).map((paragraph) => (
                      <p key={paragraph.key}>{paragraph.text}</p>
                    ))}
                  </div>
                ),
              }))}
            />
          </Card>
        </section>
      ) : null}

      {reviews ? <ReviewsSlot handle={product.handle} /> : null}
    </div>
  );
}
