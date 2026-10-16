// @vitest-environment jsdom
import {cleanup, render, screen, within} from '@testing-library/react';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {AddressForm} from '~/routes/account.addresses';

afterEach(cleanup);

// P6-07, NFR-003 (accessibility): several address forms share one page, so control ids must be unique per form,
// every label must point at its own form's control, and each group is a fieldset named by a legend.

const FIRST = 'gid://shopify/CustomerAddress/1?model_name=CustomerAddress';
const SECOND = 'gid://shopify/CustomerAddress/2?model_name=CustomerAddress';

function renderForms() {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <>
            <AddressForm
              legend="Create address"
              addressId="NEW_ADDRESS_ID"
              address={{}}
              defaultAddress={null}
            >
              {() => <button type="submit">Create</button>}
            </AddressForm>
            <AddressForm
              legend="Saved address 1"
              addressId={FIRST}
              address={{firstName: 'Ada', city: 'Chicago'}}
              defaultAddress={{id: FIRST, formatted: []}}
            >
              {() => <button type="submit">Save</button>}
            </AddressForm>
            <AddressForm
              legend="Saved address 2"
              addressId={SECOND}
              address={{firstName: 'Grace'}}
              defaultAddress={{id: FIRST, formatted: []}}
            >
              {() => <button type="submit">Save</button>}
            </AddressForm>
          </>
        ),
      },
    ],
    {initialEntries: ['/']},
  );
  return render(<RouterProvider router={router} />);
}

describe('<AddressForm> on a page with several forms', () => {
  it('uses no element id twice, and the posted address id is a hidden value, not an id', async () => {
    const {container} = renderForms();
    await screen.findByRole('group', {name: 'Create address'});
    const ids = [...container.querySelectorAll('[id]')].map(
      (element) => element.id,
    );
    expect(ids.length).toBeGreaterThan(30);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.includes('gid://'))).toBe(false);
    const hidden = [
      ...container.querySelectorAll<HTMLInputElement>(
        'input[type="hidden"][name="addressId"]',
      ),
    ].map((input) => input.value);
    expect(hidden).toEqual(['NEW_ADDRESS_ID', FIRST, SECOND]);
  });

  it('points every label at a control inside its own form', async () => {
    const {container} = renderForms();
    await screen.findByRole('group', {name: 'Create address'});
    for (const form of container.querySelectorAll('form')) {
      const labels = form.querySelectorAll('label');
      expect(labels.length).toBe(11);
      for (const label of labels) {
        const target = document.getElementById(label.htmlFor);
        expect(target, label.textContent ?? '').not.toBeNull();
        expect(form.contains(target)).toBe(true);
        // WCAG 2.5.3 Label in Name: the visible label is the name; an aria-label would replace it with other words.
        expect(
          target?.hasAttribute('aria-label'),
          label.textContent ?? '',
        ).toBe(false);
      }
    }
  });

  it('names each group with a legend inside a fieldset, and keeps each form its own values', async () => {
    renderForms();
    for (const name of [
      'Create address',
      'Saved address 1',
      'Saved address 2',
    ]) {
      const group = await screen.findByRole('group', {name});
      expect(group.tagName).toBe('FIELDSET');
      expect(group.querySelector(':scope > legend')).toHaveTextContent(name);
    }
    const second = screen.getByRole('group', {name: 'Saved address 2'});
    expect(
      within(second).getByRole('textbox', {name: 'First name*'}),
    ).toHaveValue('Grace');
    const first = screen.getByRole('group', {name: 'Saved address 1'});
    expect(
      within(first).getByRole('textbox', {name: 'First name*'}),
    ).toHaveValue('Ada');
    expect(
      within(first).getByRole('checkbox', {name: 'Set as default address'}),
    ).toBeChecked();
    expect(
      within(second).getByRole('checkbox', {name: 'Set as default address'}),
    ).not.toBeChecked();
  });
});
