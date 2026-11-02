// @vitest-environment jsdom
// REQ-CNT-001, REQ-HOME-001: the map is a section of the home page only; the footer keeps the address and phone.
import {cleanup, render, screen} from '@testing-library/react';
import {createRoutesStub} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {SiteFooter} from '~/components/layout/SiteFooter';
import {VisitSection} from '~/components/home/VisitSection';
import {BUSINESS_PHONE} from '~/lib/business';

afterEach(cleanup);

function renderIn(element: React.ReactNode) {
  const Stub = createRoutesStub([{path: '/', Component: () => element}]);
  return render(<Stub initialEntries={['/']} />);
}

describe('the home "Visit our store" section', () => {
  it('shows the address, the call link, directions and a titled map frame', async () => {
    renderIn(<VisitSection />);
    expect(
      await screen.findByRole('heading', {level: 2, name: /visit our store/i}),
    ).toBeInTheDocument();
    expect(screen.getByText('Cypress, TX 77429')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: /758-5279/})).toHaveAttribute(
      'href',
      BUSINESS_PHONE.href,
    );
    const directions = screen.getByRole('link', {name: /get directions/i});
    expect(directions).toHaveAttribute('rel', 'noopener noreferrer');
    const frame = screen.getByTitle(/map showing the store/i);
    expect(frame).toHaveAttribute('loading', 'lazy');
    expect(frame.getAttribute('src')).toMatch(
      /^https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?/,
    );
  });
});

describe('the footer', () => {
  it('has the address and phone but no map', async () => {
    renderIn(<SiteFooter supportPhone={BUSINESS_PHONE} />);
    expect(await screen.findByText('Cypress, TX 77429')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: /758-5279/})).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });
});
