import {useEffect, useMemo, useRef, useState, type RefObject} from 'react';
import {
  useLoaderData,
  useNavigation,
  useSearchParams,
  type ShouldRevalidateFunction,
} from 'react-router';
import type {Route} from './+types/quiz._index';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {PreviewNotice} from '~/components/pages/PreviewNotice';
import {QuizIntro} from '~/components/quiz/QuizIntro';
import {QuizQuestion} from '~/components/quiz/QuizQuestion';
import {QuizResults, type ResultClick} from '~/components/quiz/QuizResults';
import {getLocalStorage} from '~/lib/pages/browser-storage';
import {previewRobotsMeta} from '~/lib/pages/head';
import {
  INTRO_STATE,
  RESULTS_STEP,
  STEP_PARAM,
  decodeFlow,
  encodeFlow,
  progressOf,
  readEntryPoint,
  reduceFlow,
  type QuizFlowAction,
  type QuizFlowState,
} from '~/lib/pages/quiz-flow';
import {
  answerSummary,
  buildSavedQuiz,
  emptyOutcomeMessage,
  isResumable,
  seeAllMatchesPath,
} from '~/lib/pages/quiz-view';
import {getQuizConfigRaw, getQuizProducts} from '~/lib/pages/data-source';
import {track} from '~/lib/pages/track';
import {resolveQuizConfig} from '~/lib/quiz/default-config';
import {
  buildQuizCompleteEvent,
  buildQuizResultClickEvent,
  buildQuizStartEvent,
} from '~/lib/quiz/events';
import {scoreProducts} from '~/lib/quiz/score';
import type {QuizConfig} from '~/lib/quiz/types';
import {
  clearQuizFromDevice,
  loadQuizFromDevice,
  saveQuizToDevice,
  type SavedQuiz,
} from '~/lib/quiz/storage';

// P6-03 / P6-10: the sleep quiz. REQ-QZ-001 (flow), REQ-QZ-002 (results), REQ-QZ-005 (device storage),
// REQ-QZ-006 (events through track()), REQ-QZ-007 (guidance-only note). The state lives in the URL
// (?step=3&a.feel=soft), see app/lib/pages/quiz-flow.ts.

export const meta: Route.MetaFunction = ({data}) => [
  ...previewRobotsMeta(data?.source),
  {title: formatPageTitle('Sleep quiz')},
  {
    name: 'description',
    content:
      'Answer a few quick questions and see the mattresses that best match how you sleep.',
  },
];

export async function loader({request}: Route.LoaderArgs) {
  const url = new URL(request.url);
  const [rawConfig, catalog] = await Promise.all([
    getQuizConfigRaw(),
    getQuizProducts(),
  ]);
  const {config, warnings} = resolveQuizConfig(rawConfig);
  if (rawConfig !== undefined && warnings.length > 0) {
    // Admin configuration problems are logged by code only; they hold no personal data (REQ-QZ-004).
    console.warn(
      '[quiz] configuration warnings:',
      warnings.map((warning) => warning.code).join(','),
    );
  }

  const state = decodeFlow(url.searchParams, config);
  // Scored on the server so a reload on the results is complete in the first response (no client catalog).
  const outcome =
    state.phase === 'results'
      ? scoreProducts(state.answers, catalog.products, config)
      : null;
  return {
    source: catalog.source,
    config,
    outcome,
    // Fixture variant ids are not Shopify ids, so adding them to a real cart must stay disabled.
    canAddToCart: catalog.source === 'shopify',
  };
}

// Moving between questions needs no server round trip: only the results need fresh data.
export const shouldRevalidate: ShouldRevalidateFunction = ({
  nextUrl,
  currentUrl,
  formMethod,
  defaultShouldRevalidate,
}) => {
  if (formMethod && formMethod !== 'GET') return defaultShouldRevalidate;
  if (currentUrl.pathname !== nextUrl.pathname) return true;
  return nextUrl.searchParams.get(STEP_PARAM) === RESULTS_STEP;
};

function stepKeyOf(state: QuizFlowState): string {
  return state.phase === 'question' ? `question:${state.index}` : state.phase;
}

export default function QuizPage() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const {config} = data;

  const state = useMemo(
    () => decodeFlow(searchParams, config),
    [searchParams, config],
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const startedAt = useRef<number | null>(null);
  const [saved, setSaved] = useState<SavedQuiz | null>(null);

  const hrefFor = (action: QuizFlowAction): string => {
    const query = encodeFlow(
      reduceFlow(state, action, config),
      searchParams,
    ).toString();
    return query === '' ? '?' : `?${query}`;
  };

  // A device copy is read after hydration (storage does not exist on the server), so the first render is
  // the same on both sides.
  useEffect(() => {
    if (state.phase !== 'intro') return;
    const storage = getLocalStorage();
    if (!storage) return;
    const loaded = loadQuizFromDevice(storage);
    if (
      loaded.status === 'ok' &&
      isResumable(loaded.saved, config, Date.now())
    ) {
      setSaved(loaded.saved);
    }
  }, [state.phase, config]);

  // On a step change: move focus to the new heading, and if the shopper just answered the last question,
  // record the completion once and remember the results on this device.
  const stepKey = stepKeyOf(state);
  const previousStep = useRef(stepKey);
  useEffect(() => {
    const previous = previousStep.current;
    if (previous === stepKey) return;
    previousStep.current = stepKey;
    headingRef.current?.focus();

    if (
      state.phase === 'results' &&
      previous.startsWith('question') &&
      data.outcome
    ) {
      track(
        buildQuizCompleteEvent({
          questionCount: config.questions.length,
          answers: state.answers,
          outcome: data.outcome,
          durationMs:
            startedAt.current === null
              ? undefined
              : Date.now() - startedAt.current,
        }),
      );
      const storage = getLocalStorage();
      const toSave = buildSavedQuiz({
        answers: state.answers,
        outcome: data.outcome,
        config,
        nowMs: Date.now(),
      });
      if (storage && toSave) saveQuizToDevice(storage, toSave);
    }
  }, [stepKey, state, data.outcome, config]);

  const goingToResults =
    navigation.state === 'loading' &&
    navigation.location !== undefined &&
    new URLSearchParams(navigation.location.search).get(STEP_PARAM) ===
      RESULTS_STEP;

  const onResultClick = (click: ResultClick) => {
    track(buildQuizResultClickEvent(click));
  };

  const retake = () => {
    const storage = getLocalStorage();
    if (storage) clearQuizFromDevice(storage);
    setSaved(null);
  };

  const resume = saved
    ? reduceFlow(INTRO_STATE, {type: 'resume', answers: saved.answers}, config)
    : null;

  return (
    <div className="mx-auto flex max-w-prose flex-col gap-6 py-8 md:max-w-page">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Sleep quiz</h1>
      </header>
      {data.source === 'fixtures' ? (
        <PreviewNotice subject="mattresses" />
      ) : null}

      <div className="max-w-prose md:max-w-none">
        {state.phase === 'intro' ? (
          <QuizIntro
            questionCount={config.questions.length}
            startHref={hrefFor({type: 'start'})}
            headingRef={headingRef}
            onStart={() => {
              startedAt.current = Date.now();
              track(
                buildQuizStartEvent({
                  questionCount: config.questions.length,
                  entryPoint: readEntryPoint(searchParams),
                }),
              );
            }}
            saved={
              saved && resume?.phase === 'results'
                ? {
                    resumeHref: `?${encodeFlow(resume, searchParams).toString()}`,
                    onClear: retake,
                  }
                : null
            }
          />
        ) : null}

        {state.phase === 'question' ? (
          <QuizQuestionStep
            state={state}
            config={config}
            hrefFor={hrefFor}
            headingRef={headingRef}
            busy={goingToResults}
          />
        ) : null}

        {state.phase === 'results' && data.outcome ? (
          <QuizResults
            outcome={data.outcome}
            emptyMessage={
              data.outcome.status === 'empty'
                ? emptyOutcomeMessage(data.outcome.reason)
                : null
            }
            answerSummary={answerSummary(state.answers, config)}
            seeAllHref={seeAllMatchesPath(state.answers, config)}
            retakeHref={hrefFor({type: 'retake'})}
            canAddToCart={data.canAddToCart}
            headingRef={headingRef}
            onResultClick={onResultClick}
            onRetake={retake}
          />
        ) : null}
      </div>
    </div>
  );
}

type StepProps = {
  state: Extract<QuizFlowState, {phase: 'question'}>;
  config: QuizConfig;
  hrefFor: (action: QuizFlowAction) => string;
  headingRef: RefObject<HTMLHeadingElement>;
  busy: boolean;
};

function QuizQuestionStep({
  state,
  config,
  hrefFor,
  headingRef,
  busy,
}: StepProps) {
  const question = config.questions[state.index];
  if (!question) return null;
  const selectedIds = state.answers[question.id] ?? [];
  return (
    <QuizQuestion
      key={question.id}
      question={question}
      progress={progressOf(state, config)}
      selectedIds={selectedIds}
      optionHref={(optionId) => hrefFor({type: 'select', optionId})}
      backHref={hrefFor({type: 'back'})}
      continueHref={selectedIds.length > 0 ? hrefFor({type: 'next'}) : null}
      headingRef={headingRef}
      busy={busy}
    />
  );
}
