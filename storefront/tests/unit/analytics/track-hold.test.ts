import {afterEach, describe, expect, it, vi} from 'vitest';
import {setTrackSink, track, type AnalyticsEvent} from '~/lib/analytics';

// P7-01 bundle budget: the consent layer registers its sink from a lazy chunk, after the page's first events. They
// are held (bounded) and replayed in order; the runtime behind the sink still decides what consent allows.

afterEach(() => {
  setTrackSink(null);
  vi.restoreAllMocks();
});

const event = (name: AnalyticsEvent['name'], n = 0): AnalyticsEvent => ({
  name,
  params: {n},
});

describe('events that arrive before the sink exists', () => {
  it('are replayed to the sink, in order, when it registers', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    track(event('page_view'));
    track(event('view_item'));
    const received: string[] = [];
    setTrackSink((e) => received.push(e.name));
    expect(received).toEqual(['page_view', 'view_item']);
    track(event('add_to_cart'));
    expect(received).toEqual(['page_view', 'view_item', 'add_to_cart']);
  });

  it('are replayed once only', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    track(event('page_view'));
    const first = vi.fn();
    setTrackSink(first);
    setTrackSink(null);
    const second = vi.fn();
    setTrackSink(second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('are bounded: the oldest are dropped past 25', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    for (let i = 0; i < 40; i += 1) track(event('view_item', i));
    const seen: number[] = [];
    setTrackSink((e) => seen.push(Number(e.params.n)));
    expect(seen).toHaveLength(25);
    expect(seen[0]).toBe(15);
    expect(seen.at(-1)).toBe(39);
  });

  it('unregistering the sink empties the hold, so nothing from an earlier page is replayed to a later sink', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    track(event('page_view'));
    setTrackSink(null);
    const sink = vi.fn();
    setTrackSink(sink);
    expect(sink).not.toHaveBeenCalled();
  });

  it('a sink that throws on replay does not stop the others or the page', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    track(event('page_view'));
    track(event('view_item'));
    const seen: string[] = [];
    let calls = 0;
    expect(() =>
      setTrackSink((e) => {
        calls += 1;
        if (calls === 1) throw new Error('provider down');
        seen.push(e.name);
      }),
    ).not.toThrow();
    expect(seen).toEqual(['view_item']);
  });
});
