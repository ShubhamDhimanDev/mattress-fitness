// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {Rating, ratingText} from '~/components/ui/Rating';

afterEach(cleanup);

// Shared UI (REQ-NAV-001); the reviews provider arrives with REQ-PDP-005 (Q-011).
describe('ratingText', () => {
  const cases: Array<[number, number | undefined, string]> = [
    [4.5, 128, 'Rated 4.5 out of 5 stars from 128 reviews'],
    [5, 1, 'Rated 5 out of 5 stars from 1 review'],
    [3.26, undefined, 'Rated 3.3 out of 5 stars'],
    [7, 3, 'Rated 5 out of 5 stars from 3 reviews'],
    [-2, 3, 'Rated 0 out of 5 stars from 3 reviews'],
    [Number.NaN, 3, 'Rated 0 out of 5 stars from 3 reviews'],
  ];
  it.each(cases)('value %s, count %s', (value, count, expected) => {
    expect(ratingText(value, count)).toBe(expected);
  });
});

describe('<Rating>', () => {
  it('exposes one accessible sentence and hides the decorative stars', () => {
    const {container} = render(<Rating value={4.5} count={128} />);
    expect(
      screen.getByText('Rated 4.5 out of 5 stars from 128 reviews'),
    ).toHaveClass('sr-only');
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(
      10, // five empty stars and five (clipped) filled stars
    );
    expect(screen.getByText('(128)')).toHaveAttribute('aria-hidden', 'true');
  });

  it('clips the partially filled star to the fractional part', () => {
    const {container} = render(<Rating value={3.5} count={10} />);
    const widths = Array.from(
      container.querySelectorAll<HTMLElement>('span[style]'),
    ).map((element) => element.style.width);
    expect(widths).toEqual(['100%', '100%', '100%', '50%', '0%']);
  });

  it('shows the empty label when there is no value or no reviews', () => {
    const {rerender} = render(<Rating value={null} />);
    expect(screen.getByText('No reviews yet')).toBeInTheDocument();
    rerender(
      <Rating value={4} count={0} emptyLabel="Be the first to review" />,
    );
    expect(screen.getByText('Be the first to review')).toBeInTheDocument();
  });

  it('renders as a link when href is given', () => {
    render(<Rating value={4} count={2} href="#reviews" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '#reviews');
  });
});
