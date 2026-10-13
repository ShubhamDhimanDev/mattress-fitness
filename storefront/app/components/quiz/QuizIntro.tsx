import type {RefObject} from 'react';
import {Button} from '~/components/ui/Button';

type QuizIntroProps = {
  questionCount: number;
  startHref: string;
  onStart: () => void;
  headingRef: RefObject<HTMLHeadingElement>;
  /** Present when results from an earlier visit were found on this device. */
  saved: {resumeHref: string; onClear: () => void} | null;
};

/** What the quiz is, how long it takes, and the guidance-only note (REQ-QZ-007). */
export function QuizIntro({
  questionCount,
  startHref,
  onStart,
  headingRef,
  saved,
}: QuizIntroProps) {
  return (
    <section
      aria-labelledby="quiz-intro-heading"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-3">
        <h2
          id="quiz-intro-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-bold text-fg"
        >
          Find a mattress that fits how you sleep
        </h2>
        <p className="text-base text-fg">
          Answer {questionCount} quick questions, one tap each. We will match
          your answers to the mattresses we sell and show your three best
          matches in your size and budget.
        </p>
        <p className="rounded-card border-2 border-line bg-surface-muted p-4 text-sm text-fg">
          <strong>Shopping guidance, not medical advice.</strong> The quiz
          suggests mattresses based on your preferences. If you have a medical
          condition or ongoing pain, talk to a health professional about what is
          right for you.
        </p>
      </div>
      <div>
        <Button to={startHref} preventScrollReset onClick={onStart} size="lg">
          Start the quiz
        </Button>
      </div>
      {saved ? (
        <div
          role="region"
          aria-labelledby="quiz-saved-heading"
          className="flex flex-col gap-3 rounded-card border-2 border-primary-700 bg-primary-50 p-4"
        >
          <h3 id="quiz-saved-heading" className="text-lg font-bold">
            Continue where you left off
          </h3>
          <p className="text-base text-fg">
            We found your last quiz results on this device.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button to={saved.resumeHref} preventScrollReset size="sm">
              See my saved results
            </Button>
            <Button variant="secondary" size="sm" onClick={saved.onClear}>
              Clear saved results
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
