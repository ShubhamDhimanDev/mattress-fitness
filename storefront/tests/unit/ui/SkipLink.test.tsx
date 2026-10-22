// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {MAIN_CONTENT_ID, SkipLink} from '~/components/layout/SkipLink';

afterEach(cleanup);

// NFR-003 (WCAG 2.4.1, 2.4.7, 1.4.11): the skip link opens over the red promo bar, where the blue focus ring is 1.31:1.
describe('<SkipLink>', () => {
  it('targets the main content and carries on-dark so its focus ring is yellow', () => {
    render(<SkipLink />);
    const link = screen.getByRole('link', {name: 'Skip to main content'});
    expect(link).toHaveAttribute('href', `#${MAIN_CONTENT_ID}`);
    expect(link).toHaveClass('on-dark');
    // Readable on the grey utility bar too (no promo bar): a dark band sits between the link and the ring.
    expect(link).toHaveClass('focus:ring-4', 'focus:ring-ink-900');
  });
});
