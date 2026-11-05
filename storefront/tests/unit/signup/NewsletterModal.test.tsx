// @vitest-environment jsdom
import {act, cleanup, render, screen} from '@testing-library/react';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  NewsletterModal,
  shouldShowNewsletter,
} from '~/components/signup/NewsletterModal';

// REQ-ANL-003 / CR-34: the newsletter pop-up on the home page, in jsdom. The signup form inside it is covered by
// SignupForm.test.tsx and the server side by newsletter-server.test.ts. Not seen in a browser: no layout or axe claim.

const DAY = 24 * 60 * 60 * 1000;

describe('when the pop-up is allowed to show', () => {
  const store = (value: string | null) => ({getItem: () => value});

  it.each([
    ['never shown on this browser', store(null), 1_000, true],
    ['shown yesterday', store(String(1_000)), 1_000 + DAY, false],
    ['shown 13 days ago', store(String(1_000)), 1_000 + 13 * DAY, false],
    ['shown 15 days ago', store(String(1_000)), 1_000 + 15 * DAY, true],
    ['an unreadable stored value', store('not a number'), 1_000, true],
    ['storage blocked (null)', null, 1_000, true],
  ])('%s', (_name, storage, now, expected) => {
    expect(shouldShowNewsletter(storage, now)).toBe(expected);
  });

  it('shows when reading the storage throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(shouldShowNewsletter(throwing, 1_000)).toBe(true);
  });
});

describe('the pop-up', () => {
  beforeEach(() => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function renderModal() {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <NewsletterModal config={{sms: false, privacyHref: null}} />,
        },
      ],
      {initialEntries: ['/']},
    );
    render(<RouterProvider router={router} />);
  }

  it('is hidden at first, opens a few seconds later as a dialog, and says what it is for', async () => {
    renderModal();
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6100);
    });
    const dialog = await screen.findByRole('dialog', {
      name: 'Get discount coupons in your inbox',
    });
    expect(dialog).toHaveAccessibleDescription(/discount coupons/);
    // The signup form loads inside it, with its own labelled email field and the unticked consent box.
    expect(
      await screen.findByRole('textbox', {name: /Email address/}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: 'Close newsletter sign-up'}),
    ).toBeInTheDocument();
  });

  it('is not shown again within two weeks on the same browser', async () => {
    window.localStorage.setItem('newsletter-modal-shown', String(Date.now()));
    renderModal();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes with the close button and stays closed', async () => {
    renderModal();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6100);
    });
    const close = await screen.findByRole('button', {
      name: 'Close newsletter sign-up',
    });
    await act(async () => {
      close.click();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
