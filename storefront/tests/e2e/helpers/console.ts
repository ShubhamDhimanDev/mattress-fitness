import type {Page} from '@playwright/test';
import {isKnownConsoleNoise} from './a11y';
import {ourErrors} from './catalog';

export type ConsoleError = {text: string; url: string};

/**
 * Like `collectConsoleErrors`, but keeps the URL Chromium attributes to each message. A failure-injection spec stubs a
 * third party to fail; the browser itself then logs "Failed to load resource" for that one URL. That line is the
 * expected echo of the injected failure, so a spec may drop it by URL while every other error still fails.
 * Page errors (uncaught exceptions) carry no URL and are always kept.
 */
export function collectConsoleErrorsWithUrls(page: Page): ConsoleError[] {
  const errors: ConsoleError[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isKnownConsoleNoise(text)) return;
    errors.push({text, url: message.location().url});
  });
  page.on('pageerror', (error) =>
    errors.push({text: `pageerror: ${error.message}`, url: ''}),
  );
  return errors;
}

/**
 * Errors that come from our code or an unexpected URL: the known demo-store noise (`ourErrors`) is removed, and so is
 * the browser's own network echo for the URLs a spec deliberately broke.
 */
export function unexpectedErrors(
  errors: readonly ConsoleError[],
  brokenUrlPart: string,
): string[] {
  return ourErrors(
    errors
      .filter(
        (error) =>
          !(
            error.url.includes(brokenUrlPart) &&
            error.text.startsWith('Failed to load resource')
          ),
      )
      .map((error) => error.text),
  );
}
