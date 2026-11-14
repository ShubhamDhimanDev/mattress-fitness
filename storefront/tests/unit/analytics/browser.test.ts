// @vitest-environment jsdom
import {describe, expect, it} from 'vitest';
import {evaluateCurrentPage} from '~/lib/analytics/browser';

// P7-01 review 2026-10-24: the browser glue for the safe-page guard.

describe('the page verdict for the current window', () => {
  it('a normal page is safe; a private one and a personal search are not', () => {
    expect(evaluateCurrentPage(window).safe).toBe(true);
    window.history.pushState({}, '', '/account/orders/1234567890');
    expect(evaluateCurrentPage(window)).toEqual({
      safe: false,
      reason: 'private-path',
    });
    window.history.pushState({}, '', '/search?q=jane%40example.com');
    expect(evaluateCurrentPage(window)).toEqual({
      safe: false,
      reason: 'personal-search',
    });
    window.history.pushState({}, '', '/');
  });
});
