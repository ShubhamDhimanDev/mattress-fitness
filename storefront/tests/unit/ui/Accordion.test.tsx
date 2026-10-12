// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {Accordion, type AccordionItem} from '~/components/ui/Accordion';

afterEach(cleanup);

// REQ-NAV-001 (mobile navigation accordion), REQ-NAV-002 (accessible accordion equivalent), REQ-PDP-002 (collapsed sections).
const ITEMS: AccordionItem[] = [
  {id: 'a', title: 'Delivery', content: <p>Delivery text</p>},
  {id: 'b', title: 'Warranty', content: <p>Warranty text</p>},
  {id: 'c', title: 'Brand', content: <p>Brand text</p>},
  {id: 'd', title: 'Disabled', content: <p>Hidden text</p>, disabled: true},
];

function trigger(name: string) {
  return screen.getByRole('button', {name});
}

describe('<Accordion>', () => {
  it('starts collapsed, with every trigger wired to its panel', () => {
    render(<Accordion items={ITEMS} />);
    const delivery = trigger('Delivery');
    expect(delivery).toHaveAttribute('aria-expanded', 'false');
    const panelId = delivery.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId ?? '');
    expect(panel).toHaveAttribute('hidden');
    // Content stays in the DOM, so it is in the server HTML for crawlers.
    expect(panel).toHaveTextContent('Delivery text');
  });

  it('toggles with a click, and with Enter/Space activating the native button', () => {
    render(<Accordion items={ITEMS} />);
    const delivery = trigger('Delivery');
    fireEvent.click(delivery);
    expect(delivery).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', {name: 'Delivery'})).toBeVisible();
    fireEvent.click(delivery);
    expect(delivery).toHaveAttribute('aria-expanded', 'false');
    // jsdom does not synthesise click from Enter/Space; the elements are real <button>s, so the browser does.
    expect(delivery.tagName).toBe('BUTTON');
    expect(delivery).toHaveAttribute('type', 'button');
  });

  it('single mode keeps one section open', () => {
    render(<Accordion items={ITEMS} type="single" defaultOpenIds={['a']} />);
    fireEvent.click(trigger('Warranty'));
    expect(trigger('Delivery')).toHaveAttribute('aria-expanded', 'false');
    expect(trigger('Warranty')).toHaveAttribute('aria-expanded', 'true');
  });

  it('multiple mode keeps several sections open', () => {
    render(<Accordion items={ITEMS} type="multiple" />);
    fireEvent.click(trigger('Delivery'));
    fireEvent.click(trigger('Warranty'));
    expect(trigger('Delivery')).toHaveAttribute('aria-expanded', 'true');
    expect(trigger('Warranty')).toHaveAttribute('aria-expanded', 'true');
  });

  it('moves focus between triggers with the arrow keys, Home and End, wrapping and skipping disabled', () => {
    render(<Accordion items={ITEMS} />);
    const [delivery, warranty, brand] = ['Delivery', 'Warranty', 'Brand'].map(
      trigger,
    );
    delivery?.focus();
    fireEvent.keyDown(delivery as HTMLElement, {key: 'ArrowDown'});
    expect(warranty).toHaveFocus();
    fireEvent.keyDown(warranty as HTMLElement, {key: 'End'});
    expect(brand).toHaveFocus(); // the last enabled trigger
    fireEvent.keyDown(brand as HTMLElement, {key: 'ArrowDown'});
    expect(delivery).toHaveFocus(); // wraps
    fireEvent.keyDown(delivery as HTMLElement, {key: 'ArrowUp'});
    expect(brand).toHaveFocus();
    fireEvent.keyDown(brand as HTMLElement, {key: 'Home'});
    expect(delivery).toHaveFocus();
  });

  it('does not open a disabled section', () => {
    render(<Accordion items={ITEMS} />);
    expect(trigger('Disabled')).toBeDisabled();
  });

  it('uses the requested heading level around each trigger', () => {
    render(<Accordion items={ITEMS} headingLevel={4} />);
    expect(screen.getAllByRole('heading', {level: 4})).toHaveLength(4);
  });

  it('renders link rows that take part in arrow-key navigation', () => {
    render(
      <MemoryRouter>
        <Accordion
          items={[
            {id: 'sale', title: 'Sale', to: '/collections/sale'},
            {id: 'm', title: 'Mattresses', content: <p>Sizes</p>},
          ]}
        />
      </MemoryRouter>,
    );
    const sale = screen.getByRole('link', {name: 'Sale'});
    expect(sale).toHaveAttribute('href', '/collections/sale');
    sale.focus();
    fireEvent.keyDown(sale, {key: 'ArrowDown'});
    expect(trigger('Mattresses')).toHaveFocus();
  });
});
