import type {RefObject} from 'react';
import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {InfoIcon} from '~/components/ui/Icons';

type QuizIntroProps = {
  questionCount: number;
  startHref: string;
  onStart: () => void;
  headingRef: RefObject<HTMLHeadingElement>;
  /** Present when results from an earlier visit were found on this device. */
  saved: {resumeHref: string; onClear: () => void} | null;
  /** Present when a signed-in shopper has a result in their account and none on this device (REQ-QZ-005). */
  accountOffer?: {onRestore: () => void; onDismiss: () => void} | null;
  /** Sign-in link shown with a device result so it can follow the shopper across devices; null when signed in. */
  signInHref?: string | null;
};

/** What the quiz is, how long it takes, and the guidance-only note (REQ-QZ-007). */
export function QuizIntro({
  questionCount,
  startHref,
  onStart,
  headingRef,
  saved,
  accountOffer = null,
  signInHref = null,
}: QuizIntroProps) {
  return (
    <section
      aria-labelledby="quiz-intro-heading"
      className="flex flex-col gap-6"
    >
      <Card variant="raised" padding="md" className="flex flex-col gap-5">
        <h2
          id="quiz-intro-heading"
          ref={headingRef}
          tabIndex={-1}
          className="type-display text-3xl md:text-heading"
        >
          Find a mattress that fits how you sleep
        </h2>
        <p className="max-w-prose text-lead text-fg">
          Answer {questionCount} quick questions, one tap each. We will match
          your answers to the mattresses we sell and show your three best
          matches in your size and budget.
        </p>
        <div>
          <Button to={startHref} preventScrollReset onClick={onStart} size="lg">
            Start the quiz
          </Button>
        </div>
        <Card
          variant="tinted"
          padding="sm"
          className="flex max-w-prose gap-3 text-sm text-fg"
        >
          <InfoIcon className="mt-0.5 text-primary-700" />
          <p>
            <strong>Shopping guidance, not medical advice.</strong> The quiz
            suggests mattresses based on your preferences. If you have a medical
            condition or ongoing pain, talk to a health professional about what
            is right for you.
          </p>
        </Card>
      </Card>
      {saved ? (
        <Card
          as="section"
          variant="flat"
          role="region"
          aria-labelledby="quiz-saved-heading"
          className="flex flex-col gap-3"
        >
          <h3 id="quiz-saved-heading" className="type-display text-title">
            Continue where you left off
          </h3>
          <p className="text-base text-fg">
            We found your last quiz results on this device.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button to={saved.resumeHref} preventScrollReset size="sm">
              See my saved results
            </Button>
            <Button variant="outline" size="sm" onClick={saved.onClear}>
              Clear saved results
            </Button>
          </div>
          {signInHref ? (
            <p className="text-sm text-fg">
              <a href={signInHref} className="font-semibold underline">
                Sign in
              </a>{' '}
              to keep your results across devices.
            </p>
          ) : null}
        </Card>
      ) : null}
      {accountOffer ? (
        <Card
          as="section"
          variant="flat"
          role="region"
          aria-labelledby="quiz-account-heading"
          className="flex flex-col gap-3"
        >
          <h3 id="quiz-account-heading" className="type-display text-title">
            Restore your saved results
          </h3>
          <p className="text-base text-fg">
            Your account has quiz results from an earlier visit.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button size="sm" onClick={accountOffer.onRestore}>
              Restore my results
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={accountOffer.onDismiss}
            >
              Not now
            </Button>
          </div>
        </Card>
      ) : null}
    </section>
  );
}
