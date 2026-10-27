import type {RefObject} from 'react';
import {Link} from 'react-router';
import {CartForm, type OptimisticCartLineInput} from '~/lib/hydrogen/cart-form';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {useAside} from '~/components/Aside';
import {ProductTile} from '~/components/pages/ProductTile';
import {Badge} from '~/components/ui/Badge';
import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {matchPriceView} from '~/lib/pages/quiz-view';
import type {QuizMatch, QuizOutcome} from '~/lib/quiz/types';

export type ResultClick = {
  handle: string;
  position: number;
  size: QuizMatch['size'];
  target: 'product' | 'add_to_cart' | 'see_all_matches';
};

type QuizResultsProps = {
  outcome: QuizOutcome;
  /** For an empty outcome: the message to show (computed from the reason). */
  emptyMessage: string | null;
  answerSummary: readonly {
    questionId: string;
    question: string;
    answer: string;
  }[];
  seeAllHref: string;
  retakeHref: string;
  /** False while the preview fixtures are in use: their variant ids are not real. */
  canAddToCart: boolean;
  headingRef: RefObject<HTMLHeadingElement>;
  onResultClick: (click: ResultClick) => void;
  onRetake: () => void;
};

/** The top matches, reasons, prices in the chosen size, and the three actions (REQ-QZ-002). */
export function QuizResults({
  outcome,
  emptyMessage,
  answerSummary,
  seeAllHref,
  retakeHref,
  canAddToCart,
  headingRef,
  onResultClick,
  onRetake,
}: QuizResultsProps) {
  const matches = outcome.status === 'ok' ? outcome.matches : [];
  return (
    <section
      aria-labelledby="quiz-results-heading"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <h2
          id="quiz-results-heading"
          ref={headingRef}
          tabIndex={-1}
          className="type-display text-3xl md:text-heading"
        >
          {matches.length > 0 ? 'Your best matches' : 'No matches found'}
        </h2>
        <p role="status" className="text-lead text-fg-muted">
          {matches.length > 0
            ? `${matches.length} ${matches.length === 1 ? 'mattress' : 'mattresses'} matched in ${outcome.size}.`
            : (emptyMessage ?? '')}
        </p>
        <p className="text-sm text-fg-muted">
          Shopping guidance, not medical advice.
        </p>
      </div>

      {matches.length > 0 ? (
        <ol className="grid gap-4 md:grid-cols-3 md:gap-6">
          {matches.map((match) => (
            <li key={match.productId}>
              <ResultCard
                match={match}
                canAddToCart={canAddToCart}
                onResultClick={onResultClick}
              />
            </li>
          ))}
        </ol>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          to={seeAllHref}
          onClick={() =>
            onResultClick({
              handle: matches[0]?.handle ?? 'none',
              position: 1,
              size: outcome.size,
              target: 'see_all_matches',
            })
          }
        >
          See all matches
        </Button>
        <Button
          to={retakeHref}
          preventScrollReset
          variant="outline"
          size="lg"
          onClick={onRetake}
        >
          Retake quiz
        </Button>
      </div>

      {answerSummary.length > 0 ? (
        <details className="rounded-card border border-line bg-paper p-4">
          <summary className="min-h-touch cursor-pointer py-2 text-lg font-extrabold">
            Your answers
          </summary>
          <dl className="mt-2 grid gap-2">
            {answerSummary.map((item) => (
              <div key={item.questionId}>
                <dt className="text-sm text-fg-muted">{item.question}</dt>
                <dd className="font-bold">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  );
}

function ResultCard({
  match,
  canAddToCart,
  onResultClick,
}: {
  match: QuizMatch;
  canAddToCart: boolean;
  onResultClick: (click: ResultClick) => void;
}) {
  const price = matchPriceView(match);
  const click = (target: ResultClick['target']): ResultClick => ({
    handle: match.handle,
    position: match.rank,
    size: match.size,
    target,
  });
  return (
    <Card
      as="article"
      variant="raised"
      aria-labelledby={`match-${match.rank}-title`}
      className="flex h-full flex-col gap-3"
    >
      {/* Placeholder on purpose: QuizMatch carries no image (scoring keeps handles, sizes and variant ids
          only) and the preview fixtures have none. When the live loader (P6-01) adds `image` to QuizMatch,
          pass it here. */}
      <ProductTile image={null} />
      <p className="flex items-center gap-2 text-sm font-bold text-fg-muted">
        <Badge variant="new">Match {match.rank}</Badge>
        <span aria-hidden="true">·</span>
        <span>{match.brand}</span>
      </p>
      <h3 id={`match-${match.rank}-title`} className="type-display text-title">
        <Link
          to={`/products/${encodeURIComponent(match.handle)}`}
          onClick={() => onResultClick(click('product'))}
          className="underline-offset-2 hover:underline"
        >
          {match.title}
        </Link>
      </h3>
      <p className="rounded-choice bg-paper p-3 text-base text-fg">
        <span className="font-bold">Why it matches:</span> {match.reasonLine}
      </p>
      <p className="mt-auto flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-extrabold">{price.text}</span>
        {price.compareAtText ? (
          <s className="text-sm text-fg-muted">
            <span className="sr-only">Original price: </span>
            {price.compareAtText}
          </s>
        ) : null}
        <span className="text-sm text-fg-muted">{price.label}</span>
      </p>
      {canAddToCart ? (
        <AddMatchToCart
          match={match}
          onClick={() => onResultClick(click('add_to_cart'))}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <Button disabled fullWidth>
            Add to cart
          </Button>
          <p className="text-sm text-fg-muted">
            Preview only: connect the store to enable.
          </p>
        </div>
      )}
    </Card>
  );
}

function AddMatchToCart({
  match,
  onClick,
}: {
  match: QuizMatch;
  onClick: () => void;
}) {
  const {open} = useAside();
  // Only the variant id and a quantity travel to the cart; the price is read back from Shopify (T-01).
  const lines: OptimisticCartLineInput[] = [
    {merchandiseId: match.variantId, quantity: 1},
  ];
  return (
    <CartActionForm
      route="/cart"
      inputs={{lines}}
      action={CartForm.ACTIONS.LinesAdd}
    >
      {(fetcher) => (
        <Button
          type="submit"
          fullWidth
          loading={fetcher.state !== 'idle'}
          loadingLabel="Adding to cart"
          onClick={() => {
            onClick();
            open('cart');
          }}
        >
          Add {match.size} to cart
        </Button>
      )}
    </CartActionForm>
  );
}
