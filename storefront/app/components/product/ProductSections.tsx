import {Image} from '@shopify/hydrogen';
import {keyedText} from '~/lib/shopify/keys';
import {Accordion} from '~/components/ui/Accordion';
import type {ProductPageView} from '~/lib/shopify/types';

/**
 * Overview, features, specifications, brand and FAQs (REQ-PDP-002). Each section is rendered only when it
 * has data, so a product without metafields shows just its description. All text is plain (see
 * lib/shopify/rich-text.ts); nothing from the admin is inserted as HTML.
 */
export function ProductSections({product}: {product: ProductPageView}) {
  const attributes = [
    ['Comfort level', product.comfortLevel],
    ['Mattress type', product.mattressType],
    ['Sleep positions', product.sleepPositions.join(', ') || null],
    ['Benefits', product.benefits.join(', ') || null],
    ['Product line', product.productLine],
    [
      'Height',
      product.heightInches === null ? null : `${product.heightInches} in`,
    ],
  ].flatMap(([label, value]) => (label && value ? [{label, value}] : []));
  const specifications = [...attributes, ...product.specifications];

  return (
    <div className="mt-12 flex max-w-prose flex-col gap-10 lg:max-w-none">
      {product.description.length > 0 ? (
        <section aria-labelledby="pdp-overview-heading">
          <h2 id="pdp-overview-heading" className="mb-3 text-2xl font-bold">
            Overview
          </h2>
          <div className="flex max-w-prose flex-col gap-3 text-base">
            {keyedText(product.description).map((paragraph) => (
              <p key={paragraph.key}>{paragraph.text}</p>
            ))}
          </div>
        </section>
      ) : null}

      {product.features.length > 0 ? (
        <section aria-labelledby="pdp-features-heading">
          <h2 id="pdp-features-heading" className="mb-3 text-2xl font-bold">
            Features
          </h2>
          <ul className="max-w-prose list-disc pl-6 text-base">
            {product.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {specifications.length > 0 ? (
        <section aria-labelledby="pdp-specs-heading">
          <h2 id="pdp-specs-heading" className="mb-3 text-2xl font-bold">
            Specifications
          </h2>
          <table className="w-full max-w-prose border-collapse text-left text-base">
            <tbody>
              {specifications.map((row) => (
                <tr key={row.label} className="border-b border-line">
                  <th scope="row" className="w-2/5 py-2 pr-4 font-bold">
                    {row.label}
                  </th>
                  <td className="py-2">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {product.brand &&
      (product.brand.about.length > 0 || product.brand.warranty.length > 0) ? (
        <section aria-labelledby="pdp-brand-heading">
          <h2 id="pdp-brand-heading" className="mb-3 text-2xl font-bold">
            About {product.brand.name}
          </h2>
          {product.brand.logo ? (
            <Image
              data={product.brand.logo}
              alt={product.brand.logo.altText ?? product.brand.name}
              sizes="160px"
              className="mb-3 h-auto max-h-16 w-auto"
            />
          ) : null}
          <div className="flex max-w-prose flex-col gap-3 text-base">
            {keyedText(product.brand.about).map((paragraph) => (
              <p key={paragraph.key}>{paragraph.text}</p>
            ))}
          </div>
          {product.brand.warranty.length > 0 ? (
            <div className="mt-4 max-w-prose">
              <h3 className="mb-2 text-xl font-bold">Warranty</h3>
              <div className="flex flex-col gap-3 text-base">
                {keyedText(product.brand.warranty).map((paragraph) => (
                  <p key={paragraph.key}>{paragraph.text}</p>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {product.faqs.length > 0 ? (
        <section aria-labelledby="pdp-faq-heading">
          <h2 id="pdp-faq-heading" className="mb-3 text-2xl font-bold">
            Frequently asked questions
          </h2>
          <Accordion
            type="multiple"
            headingLevel={3}
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
        </section>
      ) : null}
    </div>
  );
}
