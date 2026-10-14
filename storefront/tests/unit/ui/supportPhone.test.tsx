// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {createRoutesStub} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {MobileNav} from '~/components/layout/MobileNav';
import {PromoBar} from '~/components/layout/PromoBar';
import {SiteFooter} from '~/components/layout/SiteFooter';
import {UtilityBar} from '~/components/layout/UtilityBar';
import {MAIN_NAV, type SupportPhone} from '~/lib/navigation';

afterEach(cleanup);

// REQ-CNT-001 / B-15: no phone link and no promotion text unless the client's own value is configured.

const PHONE: SupportPhone = {
  display: '(312) 555-0142',
  href: 'tel:+13125550142',
};

function renderIn(element: React.ReactNode) {
  const Stub = createRoutesStub([{path: '/', Component: () => element}]);
  return render(<Stub initialEntries={['/']} />);
}

describe('the support phone appears only when configured', () => {
  const surfaces: ReadonlyArray<
    readonly [string, (phone: SupportPhone | null) => React.ReactNode]
  > = [
    [
      'utility bar',
      (phone) => <UtilityBar supportPhone={phone}>left</UtilityBar>,
    ],
    ['footer', (phone) => <SiteFooter supportPhone={phone} />],
    [
      'mobile menu',
      (phone) => (
        <MobileNav
          items={MAIN_NAV}
          onNavigate={() => {}}
          supportPhone={phone}
        />
      ),
    ],
  ];

  it.each(surfaces)(
    '%s: renders the number as a tel link',
    async (_name, build) => {
      renderIn(build(PHONE));
      const link = await screen.findByRole('link', {name: /555-0142/});
      expect(link).toHaveAttribute('href', 'tel:+13125550142');
    },
  );

  it.each(surfaces)(
    '%s: renders no phone link without one',
    async (_name, build) => {
      renderIn(build(null));
      await screen.findAllByRole('link');
      expect(screen.queryByRole('link', {name: /call us|555/i})).toBeNull();
      expect(document.body.innerHTML).not.toContain('tel:');
    },
  );
});

describe('the promotion bar', () => {
  it('renders nothing without a message (no invented sample text)', () => {
    const {container} = render(<PromoBar message={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(container.textContent).not.toMatch(/sample promotion/i);
  });
});
