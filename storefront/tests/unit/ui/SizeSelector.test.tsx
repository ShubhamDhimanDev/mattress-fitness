// @vitest-environment jsdom
import {useState} from 'react';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SizeSelector, type SizeOption} from '~/components/ui/SizeSelector';

afterEach(cleanup);

const OPTIONS: SizeOption[] = [
  {id: 'twin', label: 'Twin', dimensions: '38" x 75"', available: true},
  {id: 'queen', label: 'Queen', dimensions: '60" x 80"', available: true},
  {id: 'king', label: 'King', dimensions: '76" x 80"', available: false},
  {
    id: 'cal-king',
    label: 'Cal King',
    available: false,
    unavailableReason: 'Out of stock',
  },
];

function Harness({initial = null}: {initial?: string | null}) {
  const [value, setValue] = useState<string | null>(initial);
  return <SizeSelector options={OPTIONS} value={value} onChange={setValue} />;
}

// Size selector with dimensions: REQ-PDP-001 pattern (selected size shows dimensions; sold-out sizes disabled).
describe('<SizeSelector>', () => {
  it('is a labelled radio group with one radio per size', () => {
    render(<Harness />);
    expect(screen.getByRole('group', {name: /Size/})).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('asks for a size until one is selected, then shows that size dimensions', () => {
    render(<Harness />);
    expect(
      screen.getByText('Select a size to see its dimensions.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', {name: 'Queen'}));
    expect(screen.getByText('60" x 80"')).toBeInTheDocument();
    expect(screen.getByRole('radio', {name: 'Queen'})).toBeChecked();

    fireEvent.click(screen.getByRole('radio', {name: 'Twin'}));
    expect(screen.getByText('38" x 75"')).toBeInTheDocument();
    expect(screen.queryByText('60" x 80"')).not.toBeInTheDocument();
  });

  it('names the selected size in the legend', () => {
    render(<Harness initial="queen" />);
    expect(
      screen.getByRole('group', {name: 'Size: Queen'}),
    ).toBeInTheDocument();
  });

  it('disables sold-out sizes, states the reason in the accessible name and never selects them', () => {
    const onChange = vi.fn();
    render(<SizeSelector options={OPTIONS} value={null} onChange={onChange} />);

    const king = screen.getByRole('radio', {name: /^King/});
    expect(king).toBeDisabled();
    expect(screen.getByRole('radio', {name: 'King Sold out'})).toBe(king);
    expect(
      screen.getByRole('radio', {name: 'Cal King Out of stock'}),
    ).toBeDisabled();

    fireEvent.click(king);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports the id of the chosen size', () => {
    const onChange = vi.fn();
    render(<SizeSelector options={OPTIONS} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', {name: 'Twin'}));
    expect(onChange).toHaveBeenCalledWith('twin');
  });

  it('wires an error message to the group', () => {
    render(
      <SizeSelector
        options={OPTIONS}
        value={null}
        onChange={() => {}}
        error="Choose a size to continue."
      />,
    );
    const group = screen.getByRole('group');
    const message = screen.getByText('Choose a size to continue.');
    expect(group.getAttribute('aria-describedby')).toBe(
      message.closest('[id]')?.id,
    );
  });
});
