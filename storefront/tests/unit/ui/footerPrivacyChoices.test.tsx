// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {createRoutesStub} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {ConsentContext} from '~/components/consent/consent-context';
import {SiteFooter} from '~/components/layout/SiteFooter';
import {parseAnalyticsConfig} from '~/lib/analytics/config';
import {createConsentStore} from '~/lib/analytics/consent-store';

afterEach(cleanup);

// NFR-011: a shopper can withdraw consent from the footer, as easily as they gave it. With no analytics id there is
// nothing to choose, so the footer shows no control.

function renderFooter(env: Record<string, string>) {
  const config = parseAnalyticsConfig(env);
  const store = createConsentStore({
    mode: config.consentMode,
    storage: {read: () => null, write: () => {}},
  });
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => (
        <ConsentContext.Provider
          value={{config, store, snapshot: store.getSnapshot()}}
        >
          <SiteFooter />
        </ConsentContext.Provider>
      ),
    },
  ]);
  render(<Stub initialEntries={['/']} />);
  return store;
}

describe('footer privacy choices (NFR-011)', () => {
  it('shows a "Privacy choices" button with the legal links when an analytics id is set, and it opens the preferences', async () => {
    const store = renderFooter({PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'});
    const button = await screen.findByRole('button', {name: 'Privacy choices'});
    expect(button).toHaveAttribute('type', 'button');
    // In the bottom row's list, beside the legal links, at the 44 px touch size.
    expect(button.closest('ul')).toContainElement(
      screen.getByRole('link', {name: 'Terms'}),
    );
    expect(button).toHaveClass('min-h-touch');

    expect(store.getSnapshot().preferencesOpen).toBe(false);
    fireEvent.click(button);
    expect(store.getSnapshot().preferencesOpen).toBe(true);
  });

  it('shows it for a Meta-only configuration too', async () => {
    renderFooter({PUBLIC_META_PIXEL_ID: '123456789012345'});
    expect(
      await screen.findByRole('button', {name: 'Privacy choices'}),
    ).toBeInTheDocument();
  });

  it('renders no control, and no empty list item, when no analytics id is set', async () => {
    renderFooter({});
    await screen.findAllByRole('link');
    expect(screen.queryByRole('button', {name: 'Privacy choices'})).toBeNull();
    const empty = [...document.querySelectorAll('footer li')].filter(
      (li) => li.childElementCount === 0 && li.textContent === '',
    );
    // The wrapper is present but empty, and hidden by `empty:hidden` so it takes no space.
    expect(empty.every((li) => li.classList.contains('empty:hidden'))).toBe(
      true,
    );
  });
});
