import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  setTrackSink,
  track,
  type AnalyticsEvent,
  type TrackSink,
} from '~/lib/analytics';
import {buildQuizStartEvent} from '~/lib/quiz/events';

// P2-08: one typed, no-op `track()` shared by the quiz (REQ-QZ-006) and the later ecommerce events (REQ-ANL-001).
afterEach(() => {
  setTrackSink(null);
});

describe('track()', () => {
  it('does nothing and does not throw while no sink is registered', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(() => track({name: 'page_view', params: {}})).not.toThrow();
  });

  it('passes quiz and ecommerce events to the registered sink unchanged', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const received: AnalyticsEvent[] = [];
    const sink: TrackSink = (event) => {
      received.push(event);
    };
    setTrackSink(sink);

    const quiz = buildQuizStartEvent({questionCount: 5, entryPoint: 'home'});
    const cart: AnalyticsEvent = {
      name: 'add_to_cart',
      params: {item_id: 'queen-mattress', quantity: 1},
    };
    track(quiz);
    track(cart);

    expect(received).toEqual([quiz, cart]);
  });

  it('stops sending after the sink is unregistered', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const sink = vi.fn();
    setTrackSink(sink);
    setTrackSink(null);
    track({name: 'view_cart', params: {}});
    expect(sink).not.toHaveBeenCalled();
  });

  it('swallows a failing sink so analytics can never break the page (NFR-013)', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    setTrackSink(() => {
      throw new Error('provider down');
    });
    expect(() => track({name: 'begin_checkout', params: {}})).not.toThrow();
  });
});
