import type {RefObject} from 'react';
import {Link} from 'react-router';
import {QuizProgress} from '~/components/quiz/QuizProgress';
import {Button} from '~/components/ui/Button';
import {CheckIcon} from '~/components/ui/Icons';
import {cn} from '~/components/ui/cn';
import type {QuizProgress as QuizProgressValue} from '~/lib/pages/quiz-flow';
import type {QuizQuestion as QuizQuestionModel} from '~/lib/quiz/types';

type QuizQuestionProps = {
  question: QuizQuestionModel;
  progress: QuizProgressValue;
  selectedIds: readonly string[];
  /** Where choosing an option leads: the next question, or the results after the last one. */
  optionHref: (optionId: string) => string;
  backHref: string;
  /** Continue link for a multi-select question; null when nothing is chosen yet. */
  continueHref: string | null;
  headingRef: RefObject<HTMLHeadingElement>;
  /** True while the results are loading after the last answer. */
  busy: boolean;
};

/**
 * One question with one-tap answers (REQ-QZ-001). The options are links to the next state, so the quiz works
 * from the URL alone: a reload, the back button and a keyboard all behave like normal navigation. The chosen
 * option is marked with `aria-current` and a visible check, never with colour alone. The heading takes focus
 * when the question changes (the route moves it).
 */
export function QuizQuestion({
  question,
  progress,
  selectedIds,
  optionHref,
  backHref,
  continueHref,
  headingRef,
  busy,
}: QuizQuestionProps) {
  const headingId = `quiz-question-${question.id}`;
  const helpId = `${headingId}-help`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <QuizProgress progress={progress} />
      <div className="flex flex-col gap-2">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-bold text-fg"
        >
          {question.text}
        </h2>
        {question.helpText ? (
          <p id={helpId} className="text-base text-fg-muted">
            {question.helpText}
          </p>
        ) : null}
      </div>
      <ul
        aria-describedby={question.helpText ? helpId : undefined}
        aria-label={question.multi ? 'Choose all that apply' : 'Choose one'}
        className="grid gap-3 md:grid-cols-2"
      >
        {question.options.map((option) => {
          const selected = selectedIds.includes(option.id);
          return (
            <li key={option.id}>
              <Link
                to={optionHref(option.id)}
                preventScrollReset
                aria-current={selected ? 'true' : undefined}
                aria-disabled={busy || undefined}
                onClick={(event) => {
                  if (busy) event.preventDefault();
                }}
                className={cn(
                  'flex min-h-14 w-full items-center justify-between gap-3 rounded-choice border-2 px-4 py-3 text-left text-base font-bold transition-colors',
                  selected
                    ? 'border-ink-900 bg-accent-400 text-ink-900'
                    : 'border-line-strong bg-surface text-fg hover:border-ink-900',
                )}
              >
                <span>{option.label}</span>
                {selected ? (
                  <>
                    <CheckIcon className="size-5" />
                    <span className="sr-only">Selected</span>
                  </>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button to={backHref} preventScrollReset variant="secondary" size="sm">
          Back
        </Button>
        {question.multi ? (
          continueHref ? (
            <Button to={continueHref} preventScrollReset size="sm">
              Continue
            </Button>
          ) : (
            <Button disabled size="sm">
              Continue
            </Button>
          )
        ) : null}
      </div>
      <p role="status" className="min-h-6 text-sm text-fg-muted">
        {busy ? 'Finding your matches…' : ''}
      </p>
    </section>
  );
}
