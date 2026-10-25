// Browser-only Affirm.js loader (P4-08, REQ-CART-005). Imported only by the lazy `AffirmPromo` chunk, and that chunk only
// renders after the shopper's consent when consent is required, so a store without Affirm carries none of this.
//
// Source: docs.affirm.com "Set Up Promotional Messaging" (updated 2026-07-15, read 2026-10-26). Affirm's embed snippet is
// a minified function that (1) creates a `window.affirm` stub whose methods queue calls, (2) queues the `_affirm_config`
// values with `affirm.checkout(config)` and (3) inserts `<script async src=config.script>`, which replays the queue when
// it arrives. This is the same three steps in typed code instead of an inline script, so no inline script (and no CSP
// nonce) is needed and the script origin is the one the policy lists (`~/lib/financing/hosts`).

import {AFFIRM_SCRIPT_URL} from '~/lib/financing/hosts';

type QueuedCall = readonly [string, readonly unknown[]];

type AffirmUi = {
  _?: QueuedCall[];
  ready: (callback: () => void) => void;
  /** Present once Affirm.js itself has loaded; the stub does not have it. */
  refresh?: () => void;
};

type AffirmGlobal = {ui: AffirmUi};

declare global {
  interface Window {
    affirm?: AffirmGlobal;
  }
}

/** Method names the snippet stubs on `affirm.checkout`. */
const CHECKOUT_METHODS = [
  'set',
  'add',
  'save',
  'post',
  'open',
  'empty',
  'reset',
  'on',
  'off',
  'trigger',
  'ready',
  'setProduct',
] as const;
const CHECKOUT_GETTERS = ['get', 'token', 'url', 'items'] as const;

function queueTo(queue: QueuedCall[], method: string) {
  return (...args: unknown[]): void => {
    queue.push([method, args]);
  };
}

function installStub(config: {publicKey: string; sandbox: boolean}): void {
  const checkoutQueue: QueuedCall[] = [];
  const uiQueue: QueuedCall[] = [];
  const rootQueue: QueuedCall[] = [];

  const checkout = Object.assign(queueTo(checkoutQueue, 'set'), {
    _: checkoutQueue,
  });
  for (const name of CHECKOUT_METHODS) {
    Reflect.set(checkout, name, queueTo(checkoutQueue, name));
  }
  for (const name of CHECKOUT_GETTERS) {
    Reflect.set(checkout, name, () => undefined);
  }

  const ui: AffirmUi = {
    _: uiQueue,
    ready: queueTo(uiQueue, 'ready'),
  };

  Reflect.set(window, 'affirm', {
    checkout,
    ui,
    jsReady: queueTo(rootQueue, 'ready'),
    _: rootQueue,
  });

  // `_affirm_config` minus its `script` key, as the snippet passes it.
  checkout({
    public_api_key: config.publicKey,
    locale: 'en_US',
    country_code: 'USA',
  });
}

let started = false;

/**
 * Loads Affirm.js once per page. If the script fails to load, the message stays empty and nothing else is affected
 * (NFR-013).
 */
export function loadAffirm(config: {
  publicKey: string;
  sandbox: boolean;
}): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  if (window.affirm) return;
  installStub(config);
  const script = document.createElement('script');
  script.async = true;
  script.src = AFFIRM_SCRIPT_URL[config.sandbox ? 'sandbox' : 'production'];
  script.addEventListener('error', () => {
    script.remove();
    // Allow a later mount to try again; the stub's queue is harmless meanwhile.
    started = false;
    Reflect.deleteProperty(window, 'affirm');
  });
  document.head.appendChild(script);
}

/** Re-renders the placements after a `data-amount` changed. Safe before Affirm.js has loaded: the call waits for it. */
export function refreshAffirm(): void {
  const affirm = window.affirm;
  if (!affirm) return;
  affirm.ui.ready(() => {
    window.affirm?.ui.refresh?.();
  });
}
