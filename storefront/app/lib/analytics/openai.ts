// OpenAI (ChatGPT ads) measurement pixel (CR-33): the pure event mapping and a thin adapter around oaiq.min.js.
//
// Only one event is forwarded: the lead form's `generate_lead`, sent as OpenAI's `lead_created` of type
// `customer_action` (the call the client's ad account supplied). Other OpenAI event names exist (order, page view and
// so on) but the client supplied none of them and OpenAI's own documentation was not available to confirm their
// spelling or parameters, so none is sent (UNVERIFIED). No personal data is passed: the form's name, phone and ZIP
// never reach the pixel. The pixel script itself reads the page address and referrer; the safe-page guard in the
// runtime keeps it off private pages (page-context.ts).
//
// Facts read from the pixel's own script (oaiq.min.js 0.1.97, fetched 2026-11-02, not from documentation): the
// command queue takes `init`, `consent` (a boolean), `measure` and `measureSingle`; it sends events to
// https://bzr.openai.com/v1/sdk/events; and it stores `oppref`, `__oppref`, `__obref` and `__oaiq_consent` cookies
// and an `oaiq_consent` localStorage entry. The script is loaded only after marketing consent, and `consent true` is
// sent right after `init`, so nothing is held back waiting for a choice that was already made.

import type {AnalyticsEvent} from '~/lib/analytics';
import type {
  CookieClearer,
  Globals,
  ProviderAdapter,
  ProviderLoadResult,
  ScriptLoader,
} from '~/lib/analytics/adapter';

export const OPENAI_SCRIPT_URL = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';

export type OpenaiCall = {
  readonly name: 'lead_created';
  readonly props: Readonly<Record<string, string>>;
};

/** The `oaiq('measure', name, props)` call for an event, or null when no OpenAI event is defined for it. */
export function toOpenaiCall(event: AnalyticsEvent): OpenaiCall | null {
  return event.name === 'generate_lead'
    ? {name: 'lead_created', props: {type: 'customer_action'}}
    : null;
}

type Oaiq = (...args: unknown[]) => void;

// The bootstrap OpenAI supplied, written out: calls made before the script arrives are queued as `arguments` objects
// on `oaiq.q`, which the script replays.
// Which pixel ids have been initialised on a given oaiq: a second adapter on the same page adopts the running pixel.
const initialised = new WeakMap<object, Set<string>>();

function ensureOaiq(globals: Globals): {call: Oaiq; owner: object} {
  const existing = globals.get('oaiq');
  if (typeof existing === 'function') {
    return {
      owner: existing,
      call: (...args) => {
        Reflect.apply(existing, undefined, args);
      },
    };
  }
  const queue: unknown[] = [];
  const oaiq = function oaiq() {
    // eslint-disable-next-line prefer-rest-params
    queue.push(arguments);
  };
  Object.assign(oaiq, {q: queue});
  globals.set('oaiq', oaiq);
  return {
    owner: oaiq,
    call: (...args) => {
      Reflect.apply(oaiq, undefined, args);
    },
  };
}

export type OpenaiAdapterOptions = {
  readonly pixelId: string;
  readonly globals: Globals;
  readonly loadScript: ScriptLoader;
  readonly clearCookies?: CookieClearer;
};

const OPENAI_COOKIES = ['oppref', '__oppref', '__obref', '__oaiq_consent'];

export function createOpenaiAdapter(
  options: OpenaiAdapterOptions,
): ProviderAdapter {
  const {pixelId, globals, loadScript, clearCookies} = options;
  let oaiq: Oaiq | null = null;
  let granted = true;
  let paused = false;

  function clearStored(): void {
    try {
      clearCookies?.(OPENAI_COOKIES);
    } catch {
      // Best effort; see cookies.ts.
    }
  }

  return {
    id: 'openai',
    category: 'marketing',
    async load(): Promise<ProviderLoadResult> {
      try {
        const {call, owner} = ensureOaiq(globals);
        const done = initialised.get(owner) ?? new Set<string>();
        initialised.set(owner, done);
        if (!done.has(pixelId)) {
          done.add(pixelId);
          // `debug` is off: the client's snippet shipped with it on for testing only.
          call('init', {pixelId, debug: false});
          call('consent', true);
        }
        const result = await loadScript(OPENAI_SCRIPT_URL);
        if (result.status === 'failed') {
          return {status: 'failed', reason: result.reason};
        }
        oaiq = call;
        return {status: 'ready'};
      } catch {
        return {status: 'failed', reason: 'unavailable'};
      }
    },
    send(event) {
      if (!granted || paused) return;
      try {
        const call = toOpenaiCall(event);
        if (call && oaiq) oaiq('measure', call.name, call.props);
      } catch {
        // A provider error must never reach the page (NFR-013).
      }
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    grant() {
      granted = true;
      try {
        oaiq?.('consent', true);
      } catch {
        // See above.
      }
    },
    revoke() {
      granted = false;
      try {
        oaiq?.('consent', false);
      } catch {
        // Best effort; see cookies.ts.
      }
      clearStored();
    },
    clearStored,
  };
}
