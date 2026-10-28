import {AdminLinkAction} from '~/components/home/AdminLinkAction';
import {HighlightedText} from '~/components/home/HighlightedText';
import {Accordion} from '~/components/ui/Accordion';
import {Button, buttonStyles} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {cn} from '~/components/ui/cn';
import {Input} from '~/components/ui/Input';
import {displayHeadingClass} from '~/lib/display-type';
import {Image} from '~/lib/hydrogen/image';
import {SLEEP_QUIZ_LINK, STORE_LOCATOR_PATH} from '~/lib/navigation';
import {plainHeading} from '~/lib/shopify/home-highlight';
import {
  MAX_SETUP_CARDS,
  type BlockSection,
  type HomeCard,
} from '~/lib/shopify/home-sections';
import {keyedText} from '~/lib/shopify/keys';
import type {FaqView} from '~/lib/shopify/types';

// The five content blocks added by CR-31 (quiz band, setup cards, how it works, store finder, FAQ). Every word and image
// comes from the block's `homepage_section` entry (and its `homepage_card` entries); the only fixed text is the label of a
// button whose target is fixed too. Each block returns null when the content it needs is missing (the mapper already
// drops most; the checks here keep a block safe if it is rendered on its own).

const H2 = 'text-3xl md:text-heading';

function SectionHeading({
  id,
  text,
  className,
}: {
  id: string;
  text: string;
  className?: string;
}) {
  return (
    <h2
      id={id}
      className={cn(
        displayHeadingClass(plainHeading(text)),
        H2,
        'text-balance',
        className,
      )}
    >
      <HighlightedText text={text} />
    </h2>
  );
}

function Lead({
  paragraphs,
  inverse = false,
}: {
  paragraphs: readonly string[];
  /** White text, for the dark band (text on a band is white, never a tint). */
  inverse?: boolean;
}) {
  return (
    <>
      {keyedText(paragraphs).map((paragraph) => (
        <p
          key={paragraph.key}
          className={cn(
            'max-w-prose text-lead',
            inverse ? 'text-white' : 'text-fg-muted',
          )}
        >
          {paragraph.text}
        </p>
      ))}
    </>
  );
}

/** Heading, text, button and picture side by side on a paper panel. */
export function QuizBand({block}: {block: BlockSection}) {
  if (!block.heading) return null;
  const headingId = `${block.id}-heading`;
  const label = block.linkLabel ?? 'Take the sleep quiz';
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'grid gap-8 rounded-hero bg-paper px-4 py-11 md:gap-12 md:px-12 md:py-16',
        block.image && 'lg:grid-cols-2 lg:items-center',
      )}
    >
      <div className="flex min-w-0 flex-col items-start gap-5">
        <SectionHeading id={headingId} text={block.heading} />
        <Lead paragraphs={block.body} />
        {/* The quiz is the block's purpose, so without an admin link the button goes to it. */}
        {block.link ? (
          <AdminLinkAction
            link={block.link}
            className={buttonStyles({size: 'lg'})}
          >
            {label}
          </AdminLinkAction>
        ) : (
          <Button to={SLEEP_QUIZ_LINK.to} size="lg">
            {label}
          </Button>
        )}
      </div>
      {block.image ? (
        <Image
          data={block.image}
          alt={block.image.altText ?? ''}
          aspectRatio="4/3"
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="w-full rounded-hero object-cover"
        />
      ) : null}
    </section>
  );
}

function SetupCard({card, headingId}: {card: HomeCard; headingId: string}) {
  const titleIsLink = card.link !== null && card.linkLabel === null;
  return (
    <Card as="li" padding="none" className="flex flex-col overflow-hidden">
      {card.image ? (
        <Image
          data={card.image}
          alt={card.image.altText ?? ''}
          aspectRatio="4/3"
          sizes="(min-width: 768px) 30vw, 100vw"
          className="w-full object-cover"
        />
      ) : null}
      <div className="flex flex-1 flex-col items-start gap-3 p-6">
        <h3 id={headingId} className="type-display text-title">
          {card.link && titleIsLink ? (
            <AdminLinkAction
              link={card.link}
              className="underline underline-offset-4 hover:no-underline"
            >
              {card.title}
            </AdminLinkAction>
          ) : (
            card.title
          )}
        </h3>
        {keyedText(card.text).map((paragraph) => (
          <p key={paragraph.key} className="text-base text-fg-muted">
            {paragraph.text}
          </p>
        ))}
        {card.link && card.linkLabel ? (
          <div className="mt-auto pt-2">
            <AdminLinkAction
              link={card.link}
              className={buttonStyles({variant: 'outline'})}
            >
              {card.linkLabel}
            </AdminLinkAction>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/** Up to three cards: protection, bases, bedding or whatever the client puts in them. */
export function SetupCards({block}: {block: BlockSection}) {
  const cards = block.cards.slice(0, MAX_SETUP_CARDS);
  if (cards.length === 0) return null;
  const cardKeys = keyedText(cards.map((card) => card.title));
  const headingId = `${block.id}-heading`;
  return (
    <section aria-labelledby={block.heading ? headingId : undefined}>
      {block.heading ? (
        <SectionHeading id={headingId} text={block.heading} />
      ) : null}
      <div className={cn(block.heading && 'mt-4')}>
        <Lead paragraphs={block.body} />
      </div>
      <ul className="mt-6 grid gap-4 md:mt-9 md:grid-cols-3 md:gap-6">
        {cards.map((card, position) => (
          <SetupCard
            key={cardKeys[position].key}
            card={card}
            headingId={`${block.id}-card-${position}`}
          />
        ))}
      </ul>
    </section>
  );
}

/** Numbered steps from the cards: a red circle and the step's title and text, with the picture beside them. */
export function HowItWorks({block}: {block: BlockSection}) {
  if (block.cards.length === 0) return null;
  const headingId = `${block.id}-heading`;
  const cardKeys = keyedText(block.cards.map((card) => card.title));
  return (
    <section
      aria-labelledby={block.heading ? headingId : undefined}
      className={cn(
        'grid gap-8 md:gap-12',
        block.image && 'lg:grid-cols-2 lg:items-center',
      )}
    >
      {block.image ? (
        <Image
          data={block.image}
          alt={block.image.altText ?? ''}
          aspectRatio="4/3"
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="w-full rounded-hero object-cover"
        />
      ) : null}
      <div className="flex min-w-0 flex-col gap-4">
        {block.heading ? (
          <SectionHeading id={headingId} text={block.heading} />
        ) : null}
        <Lead paragraphs={block.body} />
        <ol className="mt-2 flex flex-col gap-6">
          {block.cards.map((card, position) => (
            <li key={cardKeys[position].key} className="flex gap-4">
              <span
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-primary-500 text-lg font-extrabold text-white"
              >
                {position + 1}
              </span>
              <div className="flex min-w-0 flex-col items-start gap-1">
                <h3 className="type-display text-title">{card.title}</h3>
                {keyedText(card.text).map((paragraph) => (
                  <p key={paragraph.key} className="text-base text-fg-muted">
                    {paragraph.text}
                  </p>
                ))}
                {card.link && card.linkLabel ? (
                  <AdminLinkAction
                    link={card.link}
                    className={buttonStyles({variant: 'link', size: 'sm'})}
                  >
                    {card.linkLabel}
                  </AdminLinkAction>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * "Find a store": a dark band with the heading, text, a ZIP field and a map picture from admin. The ZIP field is a plain
 * GET form to the stores page, which lists the stores in that ZIP area (CR31-10); the ZIP is never stored or logged here.
 */
export function StoreFinder({block}: {block: BlockSection}) {
  if (!block.heading) return null;
  const headingId = `${block.id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'on-dark grid gap-8 rounded-hero bg-ink-900 px-4 py-11 text-white md:gap-12 md:px-12 md:py-16',
        block.image && 'lg:grid-cols-2 lg:items-center',
      )}
    >
      <div className="flex min-w-0 flex-col items-start gap-5">
        <SectionHeading id={headingId} text={block.heading} />
        <Lead paragraphs={block.body} inverse />
        <form
          method="get"
          action={STORE_LOCATOR_PATH}
          className="flex w-full max-w-lg flex-col gap-3 sm:flex-row sm:items-end"
        >
          <Input
            name="zip"
            label="ZIP code"
            hideLabel
            placeholder="ZIP code"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={10}
            className="flex-1"
          />
          <Button type="submit" size="lg">
            Find stores
          </Button>
        </form>
      </div>
      {block.image ? (
        <Image
          data={block.image}
          alt={block.image.altText ?? ''}
          aspectRatio="4/3"
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="w-full rounded-hero object-cover"
        />
      ) : null}
    </section>
  );
}

const DEFAULT_FAQ_HEADING = 'Frequently asked questions';

/** The general FAQ entries as an accordion; hidden when there are none. */
export function FaqBlock({
  block,
  faqs,
}: {
  block: BlockSection;
  faqs: readonly FaqView[];
}) {
  if (faqs.length === 0) return null;
  const headingId = `${block.id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-8 md:gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"
    >
      <div className="flex min-w-0 flex-col items-start gap-4">
        <SectionHeading
          id={headingId}
          text={block.heading ?? DEFAULT_FAQ_HEADING}
        />
        <Lead paragraphs={block.body} />
        {block.link && block.linkLabel ? (
          <AdminLinkAction
            link={block.link}
            className={buttonStyles({variant: 'outline'})}
          >
            {block.linkLabel}
          </AdminLinkAction>
        ) : null}
      </div>
      <Accordion
        type="multiple"
        headingLevel={3}
        findInPage
        items={faqs.map((faq) => ({
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
  );
}
