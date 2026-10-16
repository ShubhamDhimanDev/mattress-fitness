// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ToastRegion, useToastQueue} from '~/components/ui/Toast';
import {
  DEFAULT_TOAST_DURATION_MS,
  MAX_VISIBLE_TOASTS,
  MIN_TOAST_DURATION_MS,
  RESUME_FLOOR_MS,
  type ToastInput,
} from '~/lib/toast';

// P2-03 / NFR-003: accessible toast (live regions, timing that can be paused, dismiss by button and Escape).
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness({inputs}: {inputs: readonly ToastInput[]}) {
  const {toasts, show, dismiss} = useToastQueue();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          for (const input of inputs) show(input);
        }}
      >
        Show
      </button>
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

function showToasts(inputs: readonly ToastInput[]) {
  render(<Harness inputs={inputs} />);
  fireEvent.click(screen.getByRole('button', {name: 'Show'}));
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('<ToastRegion> live regions', () => {
  it('keeps both live regions mounted while empty so a screen reader is already watching', () => {
    render(<Harness inputs={[]} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('announces info, success and warning politely and errors assertively', () => {
    showToasts([
      {message: 'Added to cart', variant: 'success'},
      {message: 'Heads up', variant: 'warning'},
      {message: 'Could not add', variant: 'error'},
    ]);
    const status = screen.getByRole('status');
    const alert = screen.getByRole('alert');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(within(status).getByText('Added to cart')).toBeInTheDocument();
    expect(within(status).getByText('Heads up')).toBeInTheDocument();
    expect(within(alert).getByText('Could not add')).toBeInTheDocument();
    expect(within(status).queryByText('Could not add')).not.toBeInTheDocument();
  });

  it('shows a title above the message and gives each toast a named dismiss button', () => {
    showToasts([{title: 'Cart', message: 'Queen mattress added'}]);
    expect(screen.getByText('Cart')).toBeInTheDocument();
    expect(screen.getByText('Queen mattress added')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: 'Dismiss notification'}),
    ).toBeInTheDocument();
  });

  it('stacks toasts and drops the oldest past the cap', () => {
    const inputs = Array.from({length: MAX_VISIBLE_TOASTS + 1}, (_, index) => ({
      message: `Message ${index + 1}`,
    }));
    showToasts(inputs);
    expect(screen.queryByText('Message 1')).not.toBeInTheDocument();
    expect(screen.getByText('Message 2')).toBeInTheDocument();
    expect(
      screen.getByText(`Message ${MAX_VISIBLE_TOASTS + 1}`),
    ).toBeInTheDocument();
  });

  it('replaces a toast that reuses an id instead of duplicating it', () => {
    showToasts([
      {id: 'cart', message: 'Adding'},
      {id: 'cart', message: 'Added'},
    ]);
    expect(screen.queryByText('Adding')).not.toBeInTheDocument();
    expect(screen.getAllByText('Added')).toHaveLength(1);
  });
});

describe('<ToastRegion> timing', () => {
  it('closes by itself after the default duration', () => {
    showToasts([{message: 'Saved'}]);
    advance(DEFAULT_TOAST_DURATION_MS - 1);
    expect(screen.getByText('Saved')).toBeInTheDocument();
    advance(1);
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('never closes sooner than the minimum, whatever duration was asked for', () => {
    showToasts([{message: 'Quick', duration: 100}]);
    advance(MIN_TOAST_DURATION_MS - 1);
    expect(screen.getByText('Quick')).toBeInTheDocument();
    advance(1);
    expect(screen.queryByText('Quick')).not.toBeInTheDocument();
  });

  it('keeps an error until it is dismissed', () => {
    showToasts([{message: 'Could not add', variant: 'error'}]);
    advance(10 * 60 * 1000);
    expect(screen.getByText('Could not add')).toBeInTheDocument();
  });

  it('pauses while hovered and resumes with at least the floor of time left', () => {
    showToasts([{message: 'Hover me'}]);
    const toast = screen
      .getByText('Hover me')
      .closest('[data-toast-variant]') as HTMLElement;

    advance(DEFAULT_TOAST_DURATION_MS - 1000); // 1 s left
    fireEvent.mouseEnter(toast);
    advance(60_000);
    expect(screen.getByText('Hover me')).toBeInTheDocument();

    fireEvent.mouseLeave(toast);
    advance(RESUME_FLOOR_MS - 1);
    expect(screen.getByText('Hover me')).toBeInTheDocument();
    advance(1);
    expect(screen.queryByText('Hover me')).not.toBeInTheDocument();
  });

  it('pauses while focus is inside and resumes when it leaves', () => {
    showToasts([{message: 'Focus me'}]);
    const dismiss = screen.getByRole('button', {name: 'Dismiss notification'});

    fireEvent.focus(dismiss);
    advance(60_000);
    expect(screen.getByText('Focus me')).toBeInTheDocument();

    fireEvent.blur(dismiss);
    advance(DEFAULT_TOAST_DURATION_MS);
    expect(screen.queryByText('Focus me')).not.toBeInTheDocument();
  });
});

describe('<ToastRegion> dismissing', () => {
  it('closes with the dismiss button', () => {
    showToasts([{message: 'Close me', variant: 'error'}]);
    fireEvent.click(screen.getByRole('button', {name: 'Dismiss notification'}));
    expect(screen.queryByText('Close me')).not.toBeInTheDocument();
  });

  it('closes with Escape from the dismiss button', () => {
    showToasts([{message: 'Escape me', variant: 'error'}]);
    fireEvent.keyDown(
      screen.getByRole('button', {name: 'Dismiss notification'}),
      {key: 'Escape'},
    );
    expect(screen.queryByText('Escape me')).not.toBeInTheDocument();
  });

  it('dismisses only the toast whose button was pressed', () => {
    showToasts([{message: 'First'}, {message: 'Second'}]);
    const buttons = screen.getAllByRole('button', {
      name: 'Dismiss notification',
    });
    fireEvent.click(buttons[0] as HTMLElement);
    expect(screen.queryByText('First')).not.toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });
});
