// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import {useState, useSyncExternalStore} from 'react';
import {MemoryRouter} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {ConsentBanner} from '~/components/consent/ConsentBanner';
import {ConsentPreferences} from '~/components/consent/ConsentPreferences';
import {ConsentContext} from '~/components/consent/consent-context';
import {PrivacyChoicesButton} from '~/components/consent/PrivacyChoicesButton';
import {parseAnalyticsConfig} from '~/lib/analytics/config';
import {createConsentStore} from '~/lib/analytics/consent-store';

// P7-01, NFR-011, NFR-003: the banner and preferences are keyboard and screen-reader usable, offer an equal
// "Reject all", and show nothing when no provider is configured. The no-shift and no-network checks are in
// tests/e2e/consent.spec.ts.

afterEach(cleanup);

function Harness({
  env,
  mode,
}: {
  env: Record<string, string>;
  mode?: 'opt-in' | 'opt-out';
}) {
  const [{config, store}] = useState(() => {
    const parsed = parseAnalyticsConfig({...env, PUBLIC_CONSENT_MODE: mode});
    return {
      config: parsed,
      store: createConsentStore({
        mode: parsed.consentMode,
        storage: {read: () => null, write: () => {}},
      }),
    };
  });
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return (
    <MemoryRouter>
      <ConsentContext.Provider value={{config, store, snapshot}}>
        <ConsentBanner />
        <ConsentPreferences />
        <PrivacyChoicesButton />
        <output data-testid="state">{JSON.stringify(snapshot.choice)}</output>
      </ConsentContext.Provider>
    </MemoryRouter>
  );
}

const BOTH = {
  PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234',
  PUBLIC_META_PIXEL_ID: '123456789012345',
};
const state = () => screen.getByTestId('state').textContent ?? '';

describe('<ConsentBanner>', () => {
  it('renders nothing when no provider is configured', () => {
    render(<Harness env={{}} />);
    expect(screen.queryByRole('region', {name: 'Privacy choices'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'Privacy choices'})).toBeNull();
  });

  it('is a labelled region, not a modal, with equal Accept all and Reject all buttons and a policy link', () => {
    render(<Harness env={BOTH} />);
    const region = screen.getByRole('region', {name: 'Privacy choices'});
    expect(region).not.toHaveAttribute('aria-modal');
    expect(
      within(region).getByRole('button', {name: 'Accept all'}),
    ).toBeVisible();
    expect(
      within(region).getByRole('button', {name: 'Reject all'}),
    ).toBeVisible();
    expect(within(region).getByRole('button', {name: 'Choose'})).toBeVisible();
    expect(
      within(region).getByRole('link', {name: 'Privacy policy'}),
    ).toHaveAttribute('href', '/policies/privacy-policy');
    expect(region.className).toContain('fixed');
  });

  it('opt-in wording says nothing is sent until the shopper agrees; opt-out wording says it can be turned off', () => {
    const {unmount} = render(<Harness env={BOTH} mode="opt-in" />);
    expect(
      screen.getByText(/Nothing is sent until you agree/),
    ).toBeInTheDocument();
    unmount();
    render(<Harness env={BOTH} mode="opt-out" />);
    expect(screen.getByText(/turn them off at any time/)).toBeInTheDocument();
  });

  it('Accept all turns both on and the banner goes away', () => {
    render(<Harness env={BOTH} />);
    expect(state()).toBe('{"analytics":false,"marketing":false}');
    fireEvent.click(screen.getByRole('button', {name: 'Accept all'}));
    expect(state()).toBe('{"analytics":true,"marketing":true}');
    expect(screen.queryByRole('region', {name: 'Privacy choices'})).toBeNull();
  });

  it('Reject all records a refusal and the banner goes away', () => {
    render(<Harness env={BOTH} />);
    fireEvent.click(screen.getByRole('button', {name: 'Reject all'}));
    expect(state()).toBe('{"analytics":false,"marketing":false}');
    expect(screen.queryByRole('region', {name: 'Privacy choices'})).toBeNull();
  });
});

describe('<ConsentPreferences>', () => {
  it('lists only the categories a configured provider needs', () => {
    render(<Harness env={{PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'}} />);
    fireEvent.click(screen.getByRole('button', {name: 'Choose'}));
    const dialog = screen.getByRole('dialog', {name: 'Privacy choices'});
    expect(
      within(dialog).getByRole('checkbox', {name: /Analytics/}),
    ).not.toBeChecked();
    expect(
      within(dialog).queryByRole('checkbox', {name: /Marketing/}),
    ).toBeNull();
  });

  it('saves the switches, and an unticked category stays off', () => {
    render(<Harness env={BOTH} />);
    fireEvent.click(screen.getByRole('button', {name: 'Choose'}));
    const dialog = screen.getByRole('dialog', {name: 'Privacy choices'});
    fireEvent.click(within(dialog).getByRole('checkbox', {name: /Analytics/}));
    fireEvent.click(within(dialog).getByRole('button', {name: 'Save choices'}));
    expect(state()).toBe('{"analytics":true,"marketing":false}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape without recording a decision, so the banner stays', () => {
    render(<Harness env={BOTH} />);
    fireEvent.click(screen.getByRole('button', {name: 'Choose'}));
    fireEvent.keyDown(screen.getByRole('dialog', {name: 'Privacy choices'}), {
      key: 'Escape',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('region', {name: 'Privacy choices'}),
    ).toBeInTheDocument();
  });

  it('can be reopened later to withdraw consent, starting from the current choice', () => {
    render(<Harness env={BOTH} />);
    fireEvent.click(screen.getByRole('button', {name: 'Accept all'}));
    fireEvent.click(screen.getByRole('button', {name: 'Privacy choices'}));
    const dialog = screen.getByRole('dialog', {name: 'Privacy choices'});
    expect(
      within(dialog).getByRole('checkbox', {name: /Analytics/}),
    ).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', {name: 'Reject all'}));
    expect(state()).toBe('{"analytics":false,"marketing":false}');
  });
});
