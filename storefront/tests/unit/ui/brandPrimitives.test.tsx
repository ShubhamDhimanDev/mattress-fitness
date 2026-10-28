// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {useState} from 'react';
import {afterEach, describe, expect, it} from 'vitest';
import {Badge} from '~/components/ui/Badge';
import {Button, buttonStyles} from '~/components/ui/Button';
import {IconButton} from '~/components/ui/IconButton';
import {Price} from '~/components/ui/Price';
import {Rating} from '~/components/ui/Rating';
import {SizeSelector, type SizeOption} from '~/components/ui/SizeSelector';

afterEach(cleanup);

// BA-03 (brand application of the shared primitives, NFR-003, UXD-13 to UXD-15): class contracts that the
// contrast test (contrast.test.ts) relies on. A colour class swapped for an off-spec one fails here.

const usd = (amount: string) => ({amount, currencyCode: 'USD'});

describe('Button variants (BA-03)', () => {
  it('primary is brand red with a heavier hover and pressed shade and a bold sentence-case label', () => {
    const classes = buttonStyles({variant: 'primary'}).split(' ');
    expect(classes).toEqual(
      expect.arrayContaining([
        'bg-primary-500',
        'text-white',
        'hover:bg-primary-600',
        'active:bg-primary-700',
        'rounded-choice',
        'font-bold',
      ]),
    );
    expect(classes).not.toContain('uppercase');
  });

  it('inverse is white with red text and inverse-outline is a white outline, both for the red band', () => {
    expect(buttonStyles({variant: 'inverse'})).toContain('bg-white');
    expect(buttonStyles({variant: 'inverse'})).toContain('text-primary-700');
    const outline = buttonStyles({variant: 'inverse-outline'});
    expect(outline).toContain('border-white');
    expect(outline).toContain('text-white');
    expect(outline).toContain('hover:bg-white');
    expect(outline).toContain('hover:text-primary-700');
  });

  // CR-31: labels are bold sentence case in every variant (the heavy uppercase of UXD-13 is retired).
  it('every variant has a bold sentence-case label', () => {
    for (const variant of [
      'primary',
      'secondary',
      'outline',
      'dark',
      'amber',
      'accent',
      'white',
      'ghost',
      'link',
      'pill',
      'inverse',
      'inverse-outline',
    ] as const) {
      const classes = buttonStyles({variant}).split(' ');
      expect(classes, variant).toContain('font-bold');
      expect(classes, variant).not.toContain('uppercase');
      expect(classes, variant).not.toContain('type-display');
    }
  });

  it('md is 48 px and lg is 56 px high, both with the 12 px radius token', () => {
    expect(buttonStyles({size: 'md'})).toContain('min-h-12');
    expect(buttonStyles({size: 'lg'})).toContain('min-h-14');
    expect(buttonStyles({size: 'sm'})).toContain('min-h-touch');
    expect(buttonStyles({size: 'lg'})).toContain('rounded-choice');
  });

  it('the new variants: outline is ink, dark is ink-filled, amber is the accent look, white is for bands, link is text', () => {
    expect(buttonStyles({variant: 'outline'})).toContain('border-ink-900');
    expect(buttonStyles({variant: 'dark'})).toContain('bg-ink-900');
    expect(buttonStyles({variant: 'amber'})).toBe(
      buttonStyles({variant: 'accent'}),
    );
    expect(buttonStyles({variant: 'white'})).toContain('bg-white');
    expect(buttonStyles({variant: 'white'})).toContain('text-ink-900');
    const link = buttonStyles({variant: 'link'});
    expect(link).toContain('underline');
    expect(link).toContain('bg-transparent');
    expect(link).not.toContain('px-6');
    expect(link).toContain('min-h-12'); // still a 48 px target
  });

  it('pill is a shape: only the pill variant and shape="pill" lose the 8 px radius', () => {
    expect(buttonStyles({variant: 'secondary'})).toContain('rounded-choice');
    expect(buttonStyles({variant: 'secondary', shape: 'pill'})).toContain(
      'rounded-pill',
    );
    expect(buttonStyles({variant: 'pill'})).toContain('rounded-pill');
  });

  it('loading and disabled stay dimmed and ignore pointer input', () => {
    render(
      <>
        <Button loading>Add to cart</Button>
        <Button disabled variant="inverse">
          Done
        </Button>
      </>,
    );
    expect(screen.getByRole('button', {name: /Add to cart/})).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', {name: 'Done'})).toHaveClass(
      'opacity-60',
      'pointer-events-none',
    );
  });
});

describe('IconButton (BA-03)', () => {
  it('the count bubble is brand red with white text and hidden from assistive technology', () => {
    render(<IconButton label="Cart, 3 items" icon={<span />} badge={3} />);
    const bubble = screen.getByText('3');
    expect(bubble).toHaveClass('bg-primary-500', 'text-white');
    expect(bubble).toHaveAttribute('aria-hidden', 'true');
  });

  it('the solid variant is brand red with hover and pressed shades', () => {
    render(<IconButton label="Delivery" icon={<span />} variant="solid" />);
    expect(screen.getByRole('button', {name: 'Delivery'})).toHaveClass(
      'bg-primary-500',
      'hover:bg-primary-600',
      'active:bg-primary-700',
    );
  });
});

describe('Badge (BA-03)', () => {
  it('sale is amber with near-black text and never brand red or error red', () => {
    render(<Badge variant="sale">Save 20%</Badge>);
    const badge = screen.getByText('Save 20%');
    expect(badge).toHaveClass('bg-accent-400', 'text-ink-900');
    expect(badge.className).not.toMatch(/primary|error/);
  });

  it('gift is amber like sale (CR-31), success is green with a check, new is black, neutral is grey', () => {
    const {container} = render(
      <>
        <Badge variant="gift">Free gift</Badge>
        <Badge variant="success">Delivered free</Badge>
        <Badge variant="new">New</Badge>
        <Badge>Firm</Badge>
      </>,
    );
    const gift = screen.getByText('Free gift');
    expect(gift).toHaveClass('bg-accent-400', 'text-ink-900');
    expect(gift.className).not.toMatch(/primary|error/);
    expect(gift.querySelector('svg')).not.toBeNull(); // the gift icon: meaning is not colour alone
    expect(screen.getByText('Delivered free')).toHaveClass(
      'bg-success-bg',
      'text-success-fg',
    );
    expect(container.querySelectorAll('svg').length).toBe(2); // gift and check only
    expect(screen.getByText('New')).toHaveClass('bg-ink-900', 'text-white');
    expect(screen.getByText('Firm')).toHaveClass('bg-ink-100', 'text-ink-700');
  });

  it('the tag size is larger sentence case; the label size stays small uppercase', () => {
    render(
      <>
        <Badge size="tag">Free delivery on this mattress</Badge>
        <Badge>Label</Badge>
      </>,
    );
    expect(screen.getByText('Free delivery on this mattress')).toHaveClass(
      'text-sm',
      'normal-case',
    );
    expect(screen.getByText('Label')).toHaveClass('text-xs', 'uppercase');
  });
});

describe('Price colours (BA-03, UXD-14)', () => {
  it('a sale price and its savings use the sale colour, never error red', () => {
    const {container} = render(
      <Price price={usd('1299.00')} compareAt={usd('1599.00')} showSavings />,
    );
    expect(container.innerHTML).not.toContain('text-error');
    expect(screen.getByText(/\$1,299\.00/)).toHaveClass(
      'text-sale-fg',
      'font-extrabold',
    );
    expect(screen.getByText('Save $300.00 (19%)')).toHaveClass('text-sale-fg');
    expect(container.querySelector('s')).toHaveClass('text-fg-muted');
  });

  it('a regular price is body colour and the "From" prefix is small, muted and not uppercase', () => {
    render(<Price price={usd('899.00')} prefix="From" />);
    expect(screen.getByText('$899.00')).toHaveClass(
      'text-fg',
      'font-extrabold',
    );
    const prefix = screen.getByText('From');
    expect(prefix).toHaveClass('text-fg-muted');
    expect(prefix).not.toHaveClass('uppercase');
  });
});

describe('Rating (BA-03)', () => {
  it('draws near-black stars on a grey track and a bold visible count', () => {
    const {container} = render(<Rating value={4} count={12} />);
    expect(container.querySelector('.text-ink-900')).not.toBeNull();
    expect(container.querySelector('.text-ink-300')).not.toBeNull();
    expect(container.innerHTML).not.toContain('accent');
    expect(screen.getByText('12 Reviews')).toHaveClass('font-bold', 'text-fg');
  });

  it('says "1 Review" for a single review and shows no count when none is given', () => {
    const {rerender} = render(<Rating value={5} count={1} />);
    expect(screen.getByText('1 Review')).toBeInTheDocument();
    rerender(<Rating value={5} />);
    expect(screen.queryByText(/Review/)).not.toBeInTheDocument();
  });
});

const OPTIONS: SizeOption[] = [
  {id: 'twin', label: 'Twin', available: true},
  {id: 'queen', label: 'Queen', available: true},
  {id: 'king', label: 'King', available: false},
];

function Harness() {
  const [value, setValue] = useState<string | null>(null);
  return <SizeSelector options={OPTIONS} value={value} onChange={setValue} />;
}

describe('SizeSelector selected state (BA-03, UXD-15)', () => {
  it('fills the selected size with brand red and prefixes it with a check icon, nothing else has one', () => {
    render(<Harness />);
    const label = (name: string | RegExp) =>
      screen.getByRole('radio', {name}).parentElement?.querySelector('label');
    expect(label('Queen')?.querySelector('svg')).toBeNull();

    fireEvent.click(screen.getByRole('radio', {name: 'Queen'}));
    expect(label('Queen')?.querySelector('svg')).not.toBeNull();
    expect(label('Queen')).toHaveClass(
      'peer-checked:bg-primary-500',
      'peer-checked:text-white',
    );
    expect(label('Twin')?.querySelector('svg')).toBeNull();
    expect(label(/^King/)?.querySelector('svg')).toBeNull();

    fireEvent.click(screen.getByRole('radio', {name: 'Twin'}));
    expect(label('Twin')?.querySelector('svg')).not.toBeNull();
    expect(label('Queen')?.querySelector('svg')).toBeNull();
  });

  it('keeps the accessible name free of the icon and lays out two columns, three from 360 px', () => {
    const {container} = render(<Harness />);
    expect(screen.getByRole('radio', {name: 'Queen'})).toBeInTheDocument();
    const grid = container.querySelector('.grid');
    expect(grid).toHaveClass('grid-cols-2', 'sm:grid-cols-3');
    expect(screen.getByRole('radio', {name: 'King Sold out'})).toBeDisabled();
  });
});
