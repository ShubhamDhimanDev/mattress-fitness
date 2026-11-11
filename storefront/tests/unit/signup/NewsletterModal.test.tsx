// @vitest-environment jsdom
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {act, cleanup, render, screen, within} from '@testing-library/react';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {NewsletterModal} from '~/components/signup/NewsletterModal';
import {SITE_IMAGES} from '~/lib/site-images';

// REQ-ANL-003 / CR-34: the newsletter pop-up on the home page, in jsdom. The signup form inside it is covered by
// SignupForm.test.tsx and the server side by newsletter-server.test.ts. Not seen in a browser: no layout or axe claim.

describe('the pop-up', () => {
  beforeEach(() => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function renderModal(promo = false) {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <NewsletterModal config={{sms: false, privacyHref: null, promo}} />
          ),
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

  it('shows on every visit, even right after it was shown before (owner request 2026-11-11)', async () => {
    window.localStorage.setItem('newsletter-modal-shown', String(Date.now()));
    renderModal();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6100);
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('sets the discount amount in brand red and the heaviest weight', async () => {
    renderModal(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6100);
    });
    const dialog = await screen.findByRole('dialog', {
      name: 'Save up to 15% off',
    });
    const amount = within(dialog).getByText('15% off');
    expect(amount).toHaveClass('font-black', 'text-primary-600');
    expect(dialog.getAttribute('aria-describedby')).not.toBeNull();
    expect(dialog).toHaveTextContent('Offer valid on orders of $599 or more.');
  });

  it('writes nothing to the browser storage', async () => {
    renderModal();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6100);
    });
    await screen.findByRole('dialog');
    expect(window.localStorage.length).toBe(0);
  });

  it("shows the owner's photograph beside the form in a wider dialog, hidden on a phone", async () => {
    renderModal();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6100);
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).toContain('max-w-dialog-wide');
    const photo = dialog.querySelector('img');
    expect(photo).not.toBeNull();
    // Decoration: empty alt, a shipped file, and not drawn below the md breakpoint.
    expect(photo).toHaveAttribute('alt', '');
    expect(photo?.getAttribute('src')).toBe(SITE_IMAGES.newsletterSleeper.src);
    expect(photo?.className).toContain('hidden');
    expect(photo?.className).toContain('md:block');
    expect(
      existsSync(resolve('public', `.${SITE_IMAGES.newsletterSleeper.src}`)),
    ).toBe(true);
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
