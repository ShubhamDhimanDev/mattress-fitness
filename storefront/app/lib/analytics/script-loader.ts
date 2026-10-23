// Adds one provider script to the page without blocking anything (P7-01, NFR-013). The script is `async` and
// appended to <head>, the caller runs this on idle after hydration, and every outcome (loaded, error, blocked by an
// ad blocker or a Content Security Policy, timed out) comes back as a typed result. This function never rejects and
// never throws: a provider that is down must not take the page with it.
//
// No Subresource Integrity: both vendors serve these files at fixed URLs that change without notice, so a pinned
// hash would break the integration on their next release (docs/integrations/ANALYTICS.md).

import type {ScriptLoadResult, ScriptLoader} from '~/lib/analytics/adapter';
import {PROVIDER_SCRIPT_ORIGINS} from '~/lib/analytics/hosts';

export const SCRIPT_TIMEOUT_MS = 10_000;

export type ScriptLoaderOptions = {
  readonly doc: Document;
  /** The page's script nonce, so the enforced policy accepts the script. */
  readonly nonce?: () => string | undefined;
  readonly timeoutMs?: number;
  readonly allowedOrigins?: ReadonlySet<string>;
};

function httpsOrigin(src: string): string {
  try {
    const url = new URL(src);
    return url.protocol === 'https:' ? url.origin : '';
  } catch {
    return '';
  }
}

export function createScriptLoader(options: ScriptLoaderOptions): ScriptLoader {
  const allowed = options.allowedOrigins ?? PROVIDER_SCRIPT_ORIGINS;
  const timeoutMs = options.timeoutMs ?? SCRIPT_TIMEOUT_MS;

  return (src) =>
    new Promise<ScriptLoadResult>((resolve) => {
      if (!allowed.has(httpsOrigin(src))) {
        resolve({status: 'failed', reason: 'origin-refused'});
        return;
      }
      try {
        const script = options.doc.createElement('script');
        script.async = true;
        script.src = src;
        const nonce = options.nonce?.();
        if (nonce) script.nonce = nonce;

        let settled = false;
        // Declared function: it runs only after `timer` below is assigned (events and the timeout are asynchronous).
        function settle(result: ScriptLoadResult) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
        const timer = setTimeout(
          () => settle({status: 'failed', reason: 'timeout'}),
          timeoutMs,
        );
        script.addEventListener('load', () => settle({status: 'loaded'}));
        script.addEventListener('error', () =>
          settle({status: 'failed', reason: 'error'}),
        );
        (options.doc.head ?? options.doc.documentElement).appendChild(script);
      } catch {
        resolve({status: 'failed', reason: 'unavailable'});
      }
    });
}
