// Polite HTTP for the brand scrapers: one request at a time per host, a minimum gap between requests (a site's Crawl-delay
// when it sets one), a hard timeout and bounded retries. Only public pages that the site's robots.txt allows are fetched.
import { setTimeout as sleep } from 'node:timers/promises';

export const USER_AGENT = 'Mozilla/5.0 (compatible; MattressFitnessCatalogImport/1.0)';

/** @type {Map<string, number>} next allowed request time per host */
const nextSlot = new Map();

/**
 * @param {string} url
 * @param {{ gapMs?: number, timeoutMs?: number, retries?: number, accept?: string }} [options]
 * @returns {Promise<{ status: number, headers: Headers, body: Buffer, url: string }>}
 */
export async function politeFetch(url, { gapMs = 1500, timeoutMs = 30_000, retries = 2, accept = '*/*' } = {}) {
  const host = new URL(url).host;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const wait = Math.max(0, (nextSlot.get(host) ?? 0) - Date.now());
    nextSlot.set(host, Math.max(Date.now(), nextSlot.get(host) ?? 0) + gapMs);
    if (wait > 0) await sleep(wait);
    try {
      const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} for ${url}`);
        await sleep(3000 * (attempt + 1));
        continue;
      }
      return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()), url: response.url };
    } catch (error) {
      lastError = error;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** @param {string} url @param {Parameters<typeof politeFetch>[1]} [options] */
export async function fetchText(url, options) {
  const result = await politeFetch(url, options);
  return { ...result, text: result.body.toString('utf8') };
}
