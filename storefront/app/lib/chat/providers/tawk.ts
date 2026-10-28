// The tawk.to adapter (REQ-ANL-004, P7-03; the owner chose tawk.to on 2026-10-28). It loads the vendor's widget script
// from `https://embed.tawk.to/<propertyId>/<widgetId>` (the address in the "Widget Code" the tawk.to dashboard shows),
// keeps the vendor's own bubble hidden, and shows and maximises the widget only when our "Chat with us" call-out asks.
//
// Methods used, all from https://developer.tawk.to/jsapi/ (read 2026-10-28): the `onLoad` and `onChatMinimized`
// callbacks, `showWidget`, `hideWidget`, `maximize`, `start` and `shutdown`. NOT documented, so not used: removing the
// widget or the script from the page. `unload` therefore hides the widget and closes its connection (`shutdown`); the
// script and the cookies tawk.to already set stay until the shopper leaves the page or clears them. A later grant reuses
// the loaded script and calls `start`, so the script is never added twice.
//
// UNVERIFIED in a browser: that `onLoad` fires with this build's CSP, and how `maximize` behaves right after `showWidget`.

import type {TawkIds} from '~/lib/chat/config';
import type {ChatProvider} from '~/lib/chat/provider';

export const TAWK_EMBED_ORIGIN = 'https://embed.tawk.to';
export const TAWK_SCRIPT_ID = 'tawk-chat-script';

export function tawkScriptUrl(ids: TawkIds): string {
  return `${TAWK_EMBED_ORIGIN}/${ids.propertyId}/${ids.widgetId}`;
}

type Call = (...args: readonly unknown[]) => unknown;

/** The vendor's global object. It starts as the empty object we hand over; the script adds its methods to it. */
function readApi(target: object): Record<string, unknown> | null {
  const api: unknown = Reflect.get(target, 'Tawk_API');
  return typeof api === 'object' && api !== null
    ? Object.fromEntries(Object.entries(api))
    : null;
}

function method(target: object, name: string): Call | null {
  const api: unknown = Reflect.get(target, 'Tawk_API');
  if (typeof api !== 'object' || api === null) return null;
  const candidate: unknown = Reflect.get(api, name);
  return typeof candidate === 'function'
    ? (...args) => Reflect.apply(candidate, api, args)
    : null;
}

export function createTawkProvider(
  ids: TawkIds,
  doc: Document = document,
  target: object = globalThis,
): ChatProvider {
  let script: HTMLScriptElement | null = null;
  let ready = false;
  let pending: Promise<void> | null = null;

  // The widget starts hidden; only our call-out shows it, and minimising it hands the shopper back to that call-out.
  const hide = (): void => {
    method(target, 'hideWidget')?.();
  };

  function inject(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Must exist before the script runs: the vendor reads the callbacks from it.
      const api: Record<string, unknown> = readApi(target) ?? {};
      api['onLoad'] = () => {
        hide();
        ready = true;
        pending = null;
        resolve();
      };
      api['onChatMinimized'] = hide;
      Reflect.set(target, 'Tawk_API', api);
      Reflect.set(target, 'Tawk_LoadStart', new Date());

      const element = doc.createElement('script');
      element.id = TAWK_SCRIPT_ID;
      element.async = true;
      element.src = tawkScriptUrl(ids);
      element.charset = 'UTF-8';
      element.addEventListener('error', () => {
        element.remove();
        script = null;
        pending = null;
        reject(new Error('tawk.to script failed to load'));
      });
      script = element;
      doc.head.append(element);
    });
  }

  return {
    id: 'tawk',
    // Idempotent: a second call while loading shares the promise; after an unload the loaded script is started again.
    load() {
      if (ready) return Promise.resolve();
      if (pending) return pending;
      if (script?.isConnected) {
        const start = method(target, 'start');
        if (start === null) {
          return Promise.reject(new Error('tawk.to cannot be started again'));
        }
        start({showWidget: false});
        hide();
        ready = true;
        return Promise.resolve();
      }
      pending = inject();
      return pending;
    },
    isReady: () => ready,
    open() {
      const show = method(target, 'showWidget');
      const maximize = method(target, 'maximize');
      if (show === null || maximize === null) {
        throw new Error('tawk.to widget is not available');
      }
      show();
      maximize();
    },
    unload() {
      hide();
      method(target, 'shutdown')?.();
      ready = false;
    },
  };
}
