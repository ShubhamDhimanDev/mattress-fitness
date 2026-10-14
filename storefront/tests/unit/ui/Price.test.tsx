// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Price, getPriceView} from '~/components/ui/Price';

afterEach(cleanup);

const usd = (amount: string) => ({amount, currencyCode: 'USD'});

// REQ-NAV-001 (shared UI), REQ-PDP-001/REQ-COL-001 price display rules reused later: a sale needs compare-at above price.
describe('getPriceView (pure view model)', () => {
  const cases: Array<{
    name: string;
    price: ReturnType<typeof usd>;
    compareAt: ReturnType<typeof usd> | null | undefined;
    expected: unknown;
  }> = [
    {
      name: 'regular price without compare-at',
      price: usd('1299.00'),
      compareAt: undefined,
      expected: {kind: 'regular', price: '$1,299.00'},
    },
    {
      name: 'null compare-at is regular',
      price: usd('899.5'),
      compareAt: null,
      expected: {kind: 'regular', price: '$899.50'},
    },
    {
      name: 'compare-at above price is a sale with integer-cent savings',
      price: usd('1299.00'),
      compareAt: usd('1599.00'),
      expected: {
        kind: 'sale',
        price: '$1,299.00',
        compareAt: '$1,599.00',
        savings: '$300.00',
        percentOff: 19,
      },
    },
    {
      name: 'compare-at equal to price is not a sale (boundary)',
      price: usd('1299.00'),
      compareAt: usd('1299.00'),
      expected: {kind: 'regular', price: '$1,299.00'},
    },
    {
      name: 'compare-at below price is not a sale (hostile data)',
      price: usd('1299.00'),
      compareAt: usd('999.00'),
      expected: {kind: 'regular', price: '$1,299.00'},
    },
    {
      name: 'one-cent savings keeps exact cents',
      price: usd('99.99'),
      compareAt: usd('100.00'),
      expected: {
        kind: 'sale',
        price: '$99.99',
        compareAt: '$100.00',
        savings: '$0.01',
        percentOff: 0,
      },
    },
  ];

  it.each(cases)('$name', ({price, compareAt, expected}) => {
    expect(getPriceView(price, compareAt)).toEqual(expected);
  });

  it('compact drops .00 from whole dollars only', () => {
    expect(getPriceView(usd('1299.00'), usd('1599.50'), true)).toMatchObject({
      price: '$1,299',
      compareAt: '$1,599.50',
      savings: '$300.50',
    });
  });

  it('returns null (and logs) for a malformed amount instead of throwing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(getPriceView(usd('12,99'), undefined)).toBeNull();
    expect(getPriceView(usd('1299.00'), usd('abc'))).toBeNull();
    expect(spy).toHaveBeenCalled();
  });

  it('returns null for a non-USD currency (NFR-008)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      getPriceView({amount: '10.00', currencyCode: 'EUR'}, undefined),
    ).toBeNull();
  });
});

describe('<Price>', () => {
  it('renders a regular price with an optional prefix', () => {
    render(<Price price={usd('899.00')} prefix="From" />);
    expect(screen.getByText('From')).toBeInTheDocument();
    expect(screen.getByText('$899.00')).toBeInTheDocument();
    expect(screen.queryByText(/Original price/)).not.toBeInTheDocument();
  });

  it('renders sale price, struck-through compare-at and savings with text for screen readers', () => {
    const {container} = render(
      <Price price={usd('1299.00')} compareAt={usd('1599.00')} showSavings />,
    );
    expect(screen.getByText(/Sale price:/)).toBeInTheDocument();
    expect(screen.getByText(/Original price:/)).toBeInTheDocument();
    expect(container.querySelector('s')).toHaveTextContent('$1,599.00');
    expect(screen.getByText('Save $300.00 (19%)')).toBeInTheDocument();
  });

  it('does not show savings unless asked', () => {
    render(<Price price={usd('1299.00')} compareAt={usd('1599.00')} />);
    expect(screen.queryByText(/^Save /)).not.toBeInTheDocument();
  });

  it('renders nothing for invalid data', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const {container} = render(<Price price={usd('nope')} />);
    expect(container).toBeEmptyDOMElement();
  });
});
