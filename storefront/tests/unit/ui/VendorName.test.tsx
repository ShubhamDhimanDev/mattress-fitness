// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {createRoutesStub} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {VendorName} from '~/components/product/VendorName';

afterEach(cleanup);

function renderIn(element: React.ReactNode) {
  const Stub = createRoutesStub([{path: '/', Component: () => element}]);
  return render(<Stub initialEntries={['/']} />);
}

// REQ-COL-005: the vendor line is a link only when the loader found a brand page.
describe('<VendorName>', () => {
  it('links to the brand page when there is one', async () => {
    renderIn(
      <VendorName
        vendor="Acme Sleep"
        brandLink={{name: 'Acme Sleep', to: '/brands/acme-sleep'}}
      />,
    );
    expect(
      await screen.findByRole('link', {name: 'Acme Sleep'}),
    ).toHaveAttribute('href', '/brands/acme-sleep');
  });

  it('is plain text, not a link, when there is none', async () => {
    renderIn(<VendorName vendor="Acme Sleep" brandLink={null} />);
    expect(await screen.findByText('Acme Sleep')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
