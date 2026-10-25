// @vitest-environment jsdom
import {cleanup, render, screen, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {ConsentBanner} from '~/components/consent/ConsentBanner';
import {parseAnalyticsConfig} from '~/lib/analytics/config';
import {createConsentStore} from '~/lib/analytics/consent-store';
import {
  NO_CONTENT,
  contentPageByHandle,
  contentPageTarget,
} from '~/lib/pages/content-pages';

// REQ-CNT-001 / NFR-011: the banner's privacy link goes where the privacy policy actually is (the footer's rule,
// `contentPageTarget`) and is left out when there is none, so the banner never links a 404.

afterEach(cleanup);

function renderBanner(privacyPath?: string | null) {
  const config = parseAnalyticsConfig({
    PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234',
  });
  const store = createConsentStore({
    mode: config.consentMode,
    storage: {read: () => null, write: () => {}},
  });
  render(
    <MemoryRouter>
      <ConsentBanner config={config} store={store} privacyPath={privacyPath} />
    </MemoryRouter>,
  );
}

const page = contentPageByHandle('privacy-policy');

describe('the consent banner privacy link', () => {
  it('keeps the policy URL when the shell says nothing', () => {
    renderBanner();
    expect(
      within(screen.getByRole('region')).getByRole('link', {
        name: 'Privacy policy',
      }),
    ).toHaveAttribute('href', '/policies/privacy-policy');
  });

  it('follows the target the shell gives: the policy, or a page with the same handle', () => {
    expect(page).not.toBeNull();
    if (!page) return;
    const policy = contentPageTarget(page, {
      ...NO_CONTENT,
      policies: new Set<'privacyPolicy'>(['privacyPolicy']),
    });
    const pageOnly = contentPageTarget(page, {
      ...NO_CONTENT,
      pages: new Set(['privacy-policy']),
    });
    expect([policy, pageOnly]).toEqual([
      '/policies/privacy-policy',
      '/pages/privacy-policy',
    ]);
    renderBanner(pageOnly);
    expect(screen.getByRole('link', {name: 'Privacy policy'})).toHaveAttribute(
      'href',
      '/pages/privacy-policy',
    );
  });

  it('shows no link at all when neither exists, and keeps the banner usable', () => {
    if (!page) throw new Error('registry');
    expect(contentPageTarget(page, NO_CONTENT)).toBeNull();
    renderBanner(null);
    const region = screen.getByRole('region');
    expect(within(region).queryByRole('link')).toBeNull();
    expect(
      within(region).getByRole('button', {name: 'Accept all'}),
    ).toBeVisible();
    expect(
      within(region).getByRole('button', {name: 'Reject all'}),
    ).toBeVisible();
  });
});
