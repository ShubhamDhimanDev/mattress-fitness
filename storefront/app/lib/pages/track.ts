// A single place that analytics events pass through (REQ-QZ-006). The provider
// and the consent gate arrive in Phase 7 (REQ-ANL-001): until then no sink is
// registered, so nothing leaves the browser. Registering the sink there is the
// only change needed for the quiz events to reach Google Analytics, and that
// sink is responsible for sending nothing without analytics consent.

import type {QuizEvent} from '~/lib/quiz/events';

export type TrackSink = (event: QuizEvent) => void;

let sink: TrackSink | null = null;

/** Phase 7 registers the consent-aware sender here; tests register a spy. */
export function setTrackSink(next: TrackSink | null): void {
  sink = next;
}

export function track(event: QuizEvent): void {
  try {
    sink?.(event);
  } catch {
    // Analytics must never break the page (NFR-013).
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console -- development-only visibility until the provider exists
    console.debug('[track]', event.name, event.params);
  }
}
