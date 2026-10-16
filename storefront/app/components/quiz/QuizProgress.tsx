import type {QuizProgress as QuizProgressValue} from '~/lib/pages/quiz-flow';

type QuizProgressProps = {
  progress: QuizProgressValue;
};

/**
 * Progress through the questions (REQ-QZ-001). A progressbar role with a text value ("Question 3 of 8")
 * so a screen reader hears the position, not just a percentage. The same text is visible above the bar.
 */
export function QuizProgress({progress}: QuizProgressProps) {
  const text = `Question ${progress.current} of ${progress.total}`;
  return (
    <div>
      <p className="mb-2 text-sm font-bold text-fg-muted" aria-hidden="true">
        {text}
      </p>
      <div
        role="progressbar"
        aria-label="Quiz progress"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.current}
        aria-valuetext={text}
        className="h-2 w-full overflow-hidden rounded-pill bg-ink-200"
      >
        <div
          className="h-full rounded-pill bg-primary-700 motion-safe:transition-[width]"
          style={{width: `${Math.max(progress.percent, 4)}%`}}
        />
      </div>
    </div>
  );
}
