import {describe, expect, it} from 'vitest';
import {previewRobotsMeta} from '~/lib/pages/head';
import {
  PRIVATE_NO_STORE_HEADERS,
  PRIVATE_REVALIDATE_HEADERS,
  forwardLoaderHeaders,
} from '~/lib/pages/private-response';

// REQ-QZ-001, REQ-CMP-001: pages on fixture data are not indexed (DEC-023, NFR-007).
describe('previewRobotsMeta', () => {
  it('asks crawlers to skip fixture-backed pages', () => {
    expect(previewRobotsMeta('fixtures')).toEqual([
      {name: 'robots', content: 'noindex,nofollow'},
    ]);
  });

  it('adds nothing for live data or before the data is known', () => {
    expect(previewRobotsMeta('shopify')).toEqual([]);
    expect(previewRobotsMeta(undefined)).toEqual([]);
  });
});

// P-L3: cookie-dependent pages are private and never stored.
describe('private responses', () => {
  it('marks the response private, no-store, varying on the cookie', () => {
    expect(PRIVATE_NO_STORE_HEADERS['Cache-Control']).toBe('private, no-store');
    expect(PRIVATE_NO_STORE_HEADERS.Vary).toBe('Cookie');
  });

  it('lets page documents be revalidated and restored from the back/forward cache, still private', () => {
    expect(PRIVATE_REVALIDATE_HEADERS['Cache-Control']).toBe(
      'private, no-cache',
    );
    expect(PRIVATE_REVALIDATE_HEADERS.Vary).toBe('Cookie');
    // no-store is what disables the back/forward cache; it must not creep back into the document policy.
    expect(PRIVATE_REVALIDATE_HEADERS['Cache-Control']).not.toContain(
      'no-store',
    );
  });

  it('forwards the loader headers to the response', () => {
    const loaderHeaders = new Headers(PRIVATE_NO_STORE_HEADERS);
    expect(forwardLoaderHeaders({loaderHeaders})).toBe(loaderHeaders);
  });
});
