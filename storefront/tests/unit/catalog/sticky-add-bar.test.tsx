// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {StickyAddBar} from '~/components/product/StickyAddBar';
import {
  isScrolledPast,
  shouldShowStickyBar,
} from '~/components/product/sticky-add-bar';

afterEach(cleanup);

// REQ-PDP-001 (CR-31, DEC-134): the phone's sticky Add to cart bar appears only after the main button is scrolled past, and steps aside at the
// end of the product content.

describe('isScrolledPast', () => {
  it.each([
    [{isIntersecting: true, top: 400}, false], // main button on screen
    [{isIntersecting: true, top: -10}, false], // partly on screen
    [{isIntersecting: false, top: 900}, false], // still below the fold: no bar over the first screen
    [{isIntersecting: false, top: -120}, true], // scrolled past
  ])('%j -> %s', (reading, expected) => {
    expect(isScrolledPast(reading)).toBe(expected);
  });
});

describe('shouldShowStickyBar', () => {
  it.each([
    [false, false, false],
    [true, false, true],
    [true, true, false], // the page end is in view: do not cover the footer
    [false, true, false],
  ])('past=%s end=%s -> %s', (pastAction, atEnd, expected) => {
    expect(shouldShowStickyBar({pastAction, atEnd})).toBe(expected);
  });
});

describe('<StickyAddBar>', () => {
  const price = {amount: '1299.00', currencyCode: 'USD'};

  it('is a named region with the price and a button that only calls onPress', () => {
    const onPress = vi.fn();
    render(
      <StickyAddBar
        productTitle="Queen mattress"
        price={price}
        compareAt={null}
        label="Add to cart"
        disabled={false}
        onPress={onPress}
      />,
    );
    const region = screen.getByRole('region', {
      name: 'Quick add to cart for Queen mattress',
    });
    expect(region).toHaveTextContent('$1,299.00');
    fireEvent.click(screen.getByRole('button', {name: 'Add to cart'}));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps the button disabled for a sold-out size', () => {
    const onPress = vi.fn();
    render(
      <StickyAddBar
        productTitle="Queen mattress"
        price={price}
        compareAt={null}
        label="Sold out"
        disabled
        onPress={onPress}
      />,
    );
    const button = screen.getByRole('button', {name: 'Sold out'});
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
