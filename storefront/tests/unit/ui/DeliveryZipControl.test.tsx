// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  DeliveryZipControl,
  DeliveryZipUnavailable,
} from '~/components/layout/DeliveryZipControl';
import {ZIP_ERROR_MESSAGE} from '~/components/layout/ZipEntryDialog';
import {DELIVERY_ERROR_TEXT} from '~/lib/delivery-runtime/response';

afterEach(cleanup);

// REQ-NAV-003 / P3B-11: the header ZIP control validates with the shared parser and reports the 5-digit ZIP;
// the saving itself is the server's (useDeliveryZip), so the dialog closes only after the server has answered.

// The dialog frame is static; the form inside is a lazy chunk (P7-06), so wait for the field before using it.
async function open() {
  fireEvent.click(
    screen.getByRole('button', {name: /delivery ZIP|Delivering to/}),
  );
  await screen.findByRole('textbox', {name: 'ZIP code'});
  return screen.getByRole('dialog', {name: 'Delivery ZIP code'});
}

function type(value: string) {
  fireEvent.change(screen.getByRole('textbox', {name: 'ZIP code'}), {
    target: {value},
  });
}

describe('<DeliveryZipControl>', () => {
  it('uses the same wording as the server for an invalid ZIP and sends nothing', async () => {
    const onSubmit = vi.fn();
    render(
      <DeliveryZipControl zip={null} onSubmit={onSubmit} onClear={vi.fn()} />,
    );
    await open();
    type('1234');
    fireEvent.click(screen.getByRole('button', {name: 'Save ZIP code'}));
    expect(screen.getByText(ZIP_ERROR_MESSAGE)).toBeInTheDocument();
    expect(ZIP_ERROR_MESSAGE).toBe(DELIVERY_ERROR_TEXT['invalid-zip']);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('reports the 5-digit ZIP and, as a local stand-in, closes at once', async () => {
    const onSubmit = vi.fn();
    render(
      <DeliveryZipControl zip={null} onSubmit={onSubmit} onClear={vi.fn()} />,
    );
    await open();
    type('60645');
    fireEvent.click(screen.getByRole('button', {name: 'Save ZIP code'}));
    expect(onSubmit).toHaveBeenCalledWith('60645');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the saved ZIP and offers to clear it', async () => {
    const onClear = vi.fn();
    render(
      <DeliveryZipControl zip="60645" onSubmit={vi.fn()} onClear={onClear} />,
    );
    expect(screen.getByText('60645')).toBeInTheDocument();
    await open();
    fireEvent.click(screen.getByRole('button', {name: 'Clear ZIP code'}));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('with a remote save stays open while pending, then closes on success', async () => {
    const onSubmit = vi.fn();
    const view = render(
      <DeliveryZipControl
        zip={null}
        onSubmit={onSubmit}
        onClear={vi.fn()}
        pending={false}
      />,
    );
    await open();
    type('60645');
    fireEvent.click(screen.getByRole('button', {name: 'Save ZIP code'}));
    expect(onSubmit).toHaveBeenCalledWith('60645');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    view.rerender(
      <DeliveryZipControl
        zip={null}
        onSubmit={onSubmit}
        onClear={vi.fn()}
        pending
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    view.rerender(
      <DeliveryZipControl
        zip="60645"
        onSubmit={onSubmit}
        onClear={vi.fn()}
        pending={false}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('with a remote save keeps the dialog open and shows the server error', async () => {
    const onSubmit = vi.fn();
    const props = {zip: null, onSubmit, onClear: vi.fn()};
    const view = render(<DeliveryZipControl {...props} pending={false} />);
    await open();
    type('60645');
    fireEvent.click(screen.getByRole('button', {name: 'Save ZIP code'}));
    view.rerender(<DeliveryZipControl {...props} pending />);
    view.rerender(
      <DeliveryZipControl
        {...props}
        pending={false}
        error={DELIVERY_ERROR_TEXT['save-failed']}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByText(DELIVERY_ERROR_TEXT['save-failed']),
    ).toBeInTheDocument();
  });
});

describe('<DeliveryZipUnavailable>', () => {
  it('is plain text: no button that opens a form which could never save, no ZIP, no promise', () => {
    render(<DeliveryZipUnavailable />);
    expect(screen.getByText('Delivery check unavailable')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Delivering to/)).toBeNull();
  });
});
