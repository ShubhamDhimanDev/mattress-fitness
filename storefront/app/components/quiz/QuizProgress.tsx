import {ProgressBar} from '~/components/ui/ProgressBar';
import type {QuizProgress as QuizProgressValue} from '~/lib/pages/quiz-flow';

type QuizProgressProps = {
  progress: QuizProgressValue;
};

/**
 * Progress through the questions (REQ-QZ-001). A progressbar role with a text value ("Question 3 of 8")
 * so a screen reader hears the position, not just a percentage. The same text is visible above the bar,
 * so the red fill is never the only cue.
 */
export function QuizProgress({progress}: QuizProgressProps) {
  const text = `Question ${progress.current} of ${progress.total}`;
  return (
    <div>
      <p className="mb-2 text-sm font-bold text-fg-muted" aria-hidden="true">
        {text}
      </p>
      <ProgressBar
        label="Quiz progress"
        min={0}
        max={progress.total}
        value={progress.current}
        valueText={text}
      />
    </div>
  );
}
