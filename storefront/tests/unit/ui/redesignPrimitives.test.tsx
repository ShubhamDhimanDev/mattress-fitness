// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {createRef} from 'react';
import {afterEach, describe, expect, it} from 'vitest';
import {Card, cardStyles} from '~/components/ui/Card';
import {Checkbox} from '~/components/ui/Checkbox';
import {Chip} from '~/components/ui/Chip';
import {Drawer} from '~/components/ui/Drawer';
import {Field} from '~/components/ui/Field';
import {IconButton} from '~/components/ui/IconButton';
import {Input} from '~/components/ui/Input';
import {ProgressBar, progressPercent} from '~/components/ui/ProgressBar';
import {QuantityStepper} from '~/components/ui/QuantityStepper';
import {Radio} from '~/components/ui/Radio';
import {Select} from '~/components/ui/Select';
import {Tabs} from '~/components/ui/Tabs';

afterEach(cleanup);

// CR-31 (REDESIGN_PLAN section 6, R2): class and behaviour contracts of the redesigned primitives. The colour pairs
// they rely on are in contrast.test.ts; the accessibility behaviour of the older ones is in their own specs.

describe('Card', () => {
  it('flat is white with the warm hairline and the 18 px card radius; raised adds the lift shadow', () => {
    expect(cardStyles({variant: 'flat'})).toContain('border-line');
    expect(cardStyles({variant: 'flat'})).toContain('bg-surface');
    expect(cardStyles({variant: 'flat'})).toContain('rounded-card');
    expect(cardStyles({variant: 'flat'})).not.toContain('shadow-lift');
    expect(cardStyles({variant: 'raised'})).toContain('shadow-lift');
  });

  it('dashed-amber is the free-gift look and tinted is paper', () => {
    const gift = cardStyles({variant: 'dashed-amber'});
    expect(gift).toContain('border-dashed');
    expect(gift).toContain('border-accent-400');
    expect(gift).toContain('bg-accent-50');
    expect(cardStyles({variant: 'tinted'})).toContain('bg-paper');
  });

  it('lifts on hover only when interactive, and the movement is behind motion-safe', () => {
    expect(cardStyles({})).not.toContain('hover:');
    const lifted = cardStyles({interactive: true});
    expect(lifted).toContain('hover:shadow-lift');
    expect(lifted).toContain('motion-safe:hover:-translate-y-0.5');
  });

  it('renders the requested element, passes the ref and the accessible name through', () => {
    const ref = createRef<HTMLElement>();
    render(
      <ul>
        <Card as="li" ref={ref} aria-label="Free gift">
          Pillow
        </Card>
      </ul>,
    );
    const item = screen.getByRole('listitem', {name: 'Free gift'});
    expect(item).toHaveTextContent('Pillow');
    expect(ref.current).toBe(item);
  });
});

describe('Chip', () => {
  it('neutral is paper, outline has a hairline for use on paper, success carries a check icon', () => {
    const {container} = render(
      <>
        <Chip>Memory foam</Chip>
        <Chip tone="outline">Firm</Chip>
        <Chip tone="success">In our delivery zone</Chip>
      </>,
    );
    expect(screen.getByText('Memory foam')).toHaveClass(
      'bg-paper',
      'rounded-pill',
    );
    expect(screen.getByText('Firm')).toHaveClass('border', 'bg-surface');
    expect(screen.getByText('In our delivery zone')).toHaveClass(
      'bg-success-bg',
      'text-success-fg',
    );
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});

describe('ProgressBar', () => {
  it('is a named progressbar with value, min and max', () => {
    render(
      <ProgressBar
        value={40}
        label="Progress to free delivery"
        valueText="$60 away"
      />,
    );
    const bar = screen.getByRole('progressbar', {
      name: 'Progress to free delivery',
    });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '$60 away');
    expect(bar.firstElementChild).toHaveStyle({width: '40%'});
  });

  it('supports another range, a success tone and a width transition that only runs with motion allowed', () => {
    render(
      <ProgressBar
        value={50}
        min={0}
        max={200}
        tone="success"
        label="Quiz progress"
      />,
    );
    const fill = screen.getByRole('progressbar').firstElementChild;
    expect(fill).toHaveStyle({width: '25%'});
    expect(fill).toHaveClass(
      'bg-success-solid',
      'motion-safe:transition-[width]',
    );
    expect(fill?.className).not.toMatch(/(^|\s)transition-/);
  });

  it.each([
    [0, 0, 100, 0],
    [100, 0, 100, 100],
    [150, 0, 100, 100],
    [-5, 0, 100, 0],
    [5, 10, 10, 0], // empty range
    [5, 20, 10, 0], // reversed range
    [Number.NaN, 0, 100, 0],
    [Number.POSITIVE_INFINITY, 0, 100, 0],
  ])('progressPercent(%s, %s, %s) = %s', (value, min, max, expected) => {
    expect(progressPercent(value, min, max)).toBe(expected);
  });

  it('never reports a value outside its range to assistive technology', () => {
    render(<ProgressBar value={500} max={100} label="Over" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
  });
});

describe('Field and form controls', () => {
  it('Input and Select are 52 px high with the 2 px control border and the 12 px radius', () => {
    render(
      <>
        <Input label="ZIP code" />
        <Select label="Feel" options={[{value: 'a', label: 'A'}]} />
      </>,
    );
    for (const control of [
      screen.getByLabelText('ZIP code'),
      screen.getByLabelText('Feel'),
    ]) {
      expect(control).toHaveClass(
        'h-13',
        'min-h-touch',
        'border-2',
        'border-line-strong',
        'rounded-choice',
      );
    }
  });

  it('an invalid input is described by its error and carries the error border', () => {
    render(<Input label="ZIP code" error="Enter a 5-digit ZIP." />);
    const input = screen.getByLabelText('ZIP code');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveClass('aria-invalid:border-error-solid');
    expect(input).toHaveAccessibleDescription('Enter a 5-digit ZIP.');
    // The error is icon plus text, never colour alone.
    expect(
      screen
        .getByText('Enter a 5-digit ZIP.')
        .closest('p')
        ?.querySelector('svg'),
    ).not.toBeNull();
  });

  it('Field wires label, hint and error to any control through the render prop', () => {
    render(
      <Field
        label="Delivery date"
        hint="Weekdays only"
        error="Pick a weekday"
        required
      >
        {(control) => <input {...control} type="text" />}
      </Field>,
    );
    const input = screen.getByRole('textbox', {name: /Delivery date/});
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Weekdays only Pick a weekday');
  });

  it('Field without a hint or error adds no description and no invalid flag', () => {
    render(<Field label="Name">{(control) => <input {...control} />}</Field>);
    const input = screen.getByRole('textbox', {name: 'Name'});
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('the card variant of Radio and Checkbox draws a bordered row that tints when checked, with the native control kept', () => {
    render(
      <>
        <Radio name="d" value="home" label="Home delivery" variant="card" />
        <Checkbox label="Compare" variant="card" />
      </>,
    );
    const radio = screen.getByRole('radio', {name: 'Home delivery'});
    expect(radio.closest('label')).toHaveClass(
      'rounded-choice',
      'border-2',
      'has-[:checked]:border-primary-500',
      'has-[:checked]:bg-primary-50',
    );
    expect(screen.getByRole('checkbox', {name: 'Compare'})).toBeInTheDocument();
  });

  it('a plain Radio row stays unframed and a card row is still a 44 px target', () => {
    render(<Radio name="p" value="x" label="Plain" />);
    const row = screen.getByRole('radio', {name: 'Plain'}).closest('label');
    expect(row).toHaveClass('min-h-touch');
    expect(row).not.toHaveClass('border-2');
  });
});

describe('QuantityStepper look', () => {
  it('has a bordered group with 46 px buttons and keeps its accessible names', () => {
    render(
      <QuantityStepper
        value={2}
        onChange={() => {}}
        itemName="Queen mattress"
      />,
    );
    expect(screen.getByRole('group', {name: 'Quantity'})).toHaveClass(
      'border-2',
      'border-line-strong',
      'rounded-choice',
    );
    expect(
      screen.getByRole('button', {name: 'Increase quantity of Queen mattress'}),
    ).toHaveClass('size-11.5');
    expect(
      screen.getByRole('button', {name: 'Decrease quantity of Queen mattress'}),
    ).toHaveClass('size-11.5');
  });
});

describe('Tabs look', () => {
  it('marks the selected tab with a 4 px brand-red bar and heavier text; the others have no bar', () => {
    render(
      <Tabs
        label="Info"
        tabs={[
          {id: 'a', label: 'Overview', content: 'A'},
          {id: 'b', label: 'Specs', content: 'B'},
        ]}
      />,
    );
    const selected = screen.getByRole('tab', {name: 'Overview'});
    expect(selected).toHaveClass(
      'border-b-4',
      'border-primary-500',
      'font-extrabold',
    );
    expect(screen.getByRole('tab', {name: 'Specs'})).toHaveClass(
      'border-transparent',
    );
    fireEvent.click(screen.getByRole('tab', {name: 'Specs'}));
    expect(screen.getByRole('tab', {name: 'Specs'})).toHaveClass(
      'border-primary-500',
    );
  });
});

describe('IconButton', () => {
  it('round is a circle and soft is a paper fill (the drawer close button)', () => {
    render(
      <IconButton label="Close" icon={<span />} variant="soft" shape="round" />,
    );
    expect(screen.getByRole('button', {name: 'Close'})).toHaveClass(
      'rounded-pill',
      'bg-paper',
      'min-h-touch',
      'min-w-touch',
    );
  });

  it('the default shape keeps the choice radius', () => {
    render(<IconButton label="Search" icon={<span />} />);
    expect(screen.getByRole('button', {name: 'Search'})).toHaveClass(
      'rounded-choice',
    );
  });
});

describe('Drawer', () => {
  it('shows the title, the count chip, a round close button and the pinned footer', () => {
    render(
      <Drawer
        open
        onClose={() => {}}
        title="Your cart"
        countLabel="3 items"
        footer={<button type="button">Checkout securely</button>}
      >
        <p>Lines</p>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', {name: 'Your cart'});
    expect(dialog).toHaveTextContent('3 items');
    expect(screen.getByRole('button', {name: 'Close'})).toHaveClass(
      'rounded-pill',
    );
    expect(
      screen.getByRole('button', {name: 'Checkout securely'}),
    ).toBeVisible();
    expect(dialog.className).toContain('max-w-drawer');
    expect(dialog.className).toContain('shadow-drawer');
  });

  it('without a footer or count there is no empty footer strip or chip', () => {
    render(
      <Drawer open onClose={() => {}} title="Menu">
        <p>Links</p>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', {name: 'Menu'});
    expect(dialog.querySelector('.border-t')).toBeNull();
    expect(dialog.querySelector('span.rounded-pill')).toBeNull();
  });

  it('bodyPadding none removes the body padding', () => {
    render(
      <Drawer open onClose={() => {}} title="Flush" bodyPadding="none">
        <p>Edge to edge</p>
      </Drawer>,
    );
    expect(screen.getByText('Edge to edge').parentElement).not.toHaveClass(
      'p-4',
    );
  });
});
