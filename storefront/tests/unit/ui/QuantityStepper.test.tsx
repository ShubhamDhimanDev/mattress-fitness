// @vitest-environment jsdom
import {useState} from 'react';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {QuantityStepper, clampQuantity} from '~/components/ui/QuantityStepper';

afterEach(cleanup);

// The stepper is a convenience: real limits (stock, haul-away maximum, Extend quantity) are server-side (REQ-PRE-003, REQ-EXT-*).
describe('clampQuantity', () => {
  const cases: Array<[number, number, number, number]> = [
    [5, 1, 10, 5],
    [0, 1, 10, 1],
    [-3, 1, 10, 1],
    [11, 1, 10, 10],
    [2.9, 1, 10, 2],
    [Number.MAX_SAFE_INTEGER, 1, 99, 99],
  ];
  it.each(cases)('clamp(%s, %s, %s) = %s', (value, min, max, expected) => {
    expect(clampQuantity(value, min, max)).toBe(expected);
  });
});

function Harness({
  initial = 2,
  min,
  max,
}: {
  initial?: number;
  min?: number;
  max?: number;
}) {
  const [value, setValue] = useState(initial);
  return (
    <QuantityStepper
      value={value}
      onChange={setValue}
      min={min}
      max={max}
      itemName="Queen mattress"
    />
  );
}

describe('<QuantityStepper>', () => {
  it('names the group, the input and both buttons for the item', () => {
    render(<Harness />);
    expect(screen.getByRole('group', {name: 'Quantity'})).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', {name: 'Quantity of Queen mattress'}),
    ).toHaveValue('2');
    expect(
      screen.getByRole('button', {name: 'Decrease quantity of Queen mattress'}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: 'Increase quantity of Queen mattress'}),
    ).toBeInTheDocument();
  });

  it('increments and decrements with the buttons', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', {name: /Increase/}));
    expect(screen.getByRole('textbox')).toHaveValue('3');
    fireEvent.click(screen.getByRole('button', {name: /Decrease/}));
    fireEvent.click(screen.getByRole('button', {name: /Decrease/}));
    expect(screen.getByRole('textbox')).toHaveValue('1');
  });

  it('stops at the minimum and the maximum and marks the button aria-disabled without dropping focus', () => {
    render(<Harness initial={1} min={1} max={2} />);
    const decrease = screen.getByRole('button', {name: /Decrease/});
    expect(decrease).toHaveAttribute('aria-disabled', 'true');
    expect(decrease).not.toBeDisabled();
    fireEvent.click(decrease);
    expect(screen.getByRole('textbox')).toHaveValue('1');

    const increase = screen.getByRole('button', {name: /Increase/});
    increase.focus();
    fireEvent.click(increase);
    expect(screen.getByRole('textbox')).toHaveValue('2');
    expect(increase).toHaveAttribute('aria-disabled', 'true');
    expect(increase).toHaveFocus();
    fireEvent.click(increase);
    expect(screen.getByRole('textbox')).toHaveValue('2');
  });

  it('uses the arrow keys in the input', () => {
    render(<Harness />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, {key: 'ArrowUp'});
    expect(input).toHaveValue('3');
    fireEvent.keyDown(input, {key: 'ArrowDown'});
    fireEvent.keyDown(input, {key: 'ArrowDown'});
    expect(input).toHaveValue('1');
  });

  it('strips non-digits while typing and clamps on blur', () => {
    render(<Harness max={5} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, {target: {value: '9a9'}});
    expect(input).toHaveValue('99');
    fireEvent.blur(input);
    expect(input).toHaveValue('5');
  });

  it('commits on Enter and rejects an empty draft', () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={2} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, {target: {value: '4'}});
    fireEvent.keyDown(input, {key: 'Enter'});
    expect(onChange).toHaveBeenLastCalledWith(4);

    onChange.mockClear();
    fireEvent.change(input, {target: {value: ''}});
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('2');
  });

  it('ignores everything when disabled', () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={2} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole('button', {name: /Increase/}));
    fireEvent.click(screen.getByRole('button', {name: /Decrease/}));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
