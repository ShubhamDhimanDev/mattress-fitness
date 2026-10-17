// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  createLazyPanel,
  LazyBoundary,
  PanelFailed,
} from '~/components/layout/LazyPanel';
import {DeliveryZipControl} from '~/components/layout/DeliveryZipControl';
import {zipFormPanel} from '~/components/layout/lazyPanels';

afterEach(cleanup);

// P7-06: the shell's panels load on demand. The helper must (a) show the fallback only while the chunk is
// missing, (b) render at once after a preload, (c) never download twice, (d) keep a failure inside its panel.

function Greeting({name}: {name: string}) {
  return <p>Hello {name}</p>;
}

function boundary(children: React.ReactNode) {
  return (
    <LazyBoundary loading={<p>loading</p>} failed={<p>failed</p>}>
      {children}
    </LazyBoundary>
  );
}

describe('createLazyPanel', () => {
  it('shows the fallback while the chunk loads, then the component with its props', async () => {
    const load = vi.fn(() => Promise.resolve(Greeting));
    const {Panel} = createLazyPanel(load);
    render(boundary(<Panel name="Ada" />));
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(await screen.findByText('Hello Ada')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('renders on the first pass, without the fallback, after a preload', async () => {
    const {Panel, preload} = createLazyPanel(() => Promise.resolve(Greeting));
    await preload();
    render(boundary(<Panel name="Ada" />));
    expect(screen.queryByText('loading')).not.toBeInTheDocument();
    expect(screen.getByText('Hello Ada')).toBeInTheDocument();
  });

  it('downloads once however often it is preloaded', async () => {
    const load = vi.fn(() => Promise.resolve(Greeting));
    const {preload} = createLazyPanel(load);
    await Promise.all([preload(), preload(), preload()]);
    await preload();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the same mounted element when it re-renders with new props', async () => {
    const {Panel} = createLazyPanel(() => Promise.resolve(Greeting));
    const view = render(boundary(<Panel name="Ada" />));
    const first = await screen.findByText('Hello Ada');
    view.rerender(boundary(<Panel name="Grace" />));
    expect(screen.getByText('Hello Grace')).toBe(first);
  });

  it('shows the failure fallback instead of throwing, and a preload failure is silent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // React reports the render error to the window as well; jsdom would print it.
    const swallow = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', swallow);
    const {Panel, preload} = createLazyPanel<{name: string}>(() =>
      Promise.reject(new Error('chunk 404')),
    );
    await expect(preload()).resolves.toBeUndefined();
    render(boundary(<Panel name="Ada" />));
    expect(await screen.findByText('failed')).toBeInTheDocument();
    window.removeEventListener('error', swallow);
  });

  it('tries again on the next preload after a failure', async () => {
    const load = vi
      .fn<() => Promise<typeof Greeting>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(Greeting);
    const {preload} = createLazyPanel(load);
    await preload();
    await preload();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

// QA-P7-L1: React.lazy keeps a rejected result, so the helper must hand out a fresh lazy component after a failure
// and the boundary must be able to mount the panel again in place.
describe('recovery after a failed download (QA-P7-L1)', () => {
  function quietFailures() {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // React reports the render error to the window as well; jsdom would print it.
    const swallow = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', swallow);
    return () => window.removeEventListener('error', swallow);
  }

  function failingThenWorking(failures: number) {
    const load = vi.fn<() => Promise<typeof Greeting>>();
    for (let i = 0; i < failures; i += 1) {
      load.mockRejectedValueOnce(new Error('offline'));
    }
    load.mockResolvedValue(Greeting);
    return load;
  }

  function withFailure(children: React.ReactNode) {
    return (
      <LazyBoundary
        loading={<p>loading</p>}
        failed={<PanelFailed href="/cart" linkText="Open the cart page" />}
      >
        {children}
      </LazyBoundary>
    );
  }

  it('shows the panel on the next mount (the shopper reopens it) when the first download failed', async () => {
    const stop = quietFailures();
    const load = failingThenWorking(1);
    const {Panel} = createLazyPanel<{name: string}>(load);
    const first = render(boundary(<Panel name="Ada" />));
    expect(await screen.findByText('failed')).toBeInTheDocument();
    first.unmount();

    render(boundary(<Panel name="Ada" />));
    expect(await screen.findByText('Hello Ada')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it('"Try again" downloads the panel again in place and renders it', async () => {
    const stop = quietFailures();
    const load = failingThenWorking(1);
    const {Panel} = createLazyPanel<{name: string}>(load);
    render(withFailure(<Panel name="Ada" />));
    const retry = await screen.findByRole('button', {name: 'Try again'});
    fireEvent.click(retry);
    expect(await screen.findByText('Hello Ada')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it('a second failure shows the fallback link again, still with "Try again", and a third attempt can succeed', async () => {
    const stop = quietFailures();
    const load = failingThenWorking(2);
    const {Panel} = createLazyPanel<{name: string}>(load);
    render(withFailure(<Panel name="Ada" />));
    fireEvent.click(await screen.findByRole('button', {name: 'Try again'}));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole('link', {name: 'Open the cart page'}),
    ).toHaveAttribute('href', '/cart');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Focus is not left on a removed button: the new "Try again" holds it.
    await waitFor(() =>
      expect(screen.getByRole('button', {name: 'Try again'})).toHaveFocus(),
    );

    fireEvent.click(screen.getByRole('button', {name: 'Try again'}));
    expect(await screen.findByText('Hello Ada')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(3);
    stop();
  });

  it('offers no "Try again" outside a boundary, and a boundary whose fallback is not PanelFailed adds none', async () => {
    const stop = quietFailures();
    render(<PanelFailed linkText="Reload the page" />);
    expect(
      screen.queryByRole('button', {name: 'Try again'}),
    ).not.toBeInTheDocument();
    cleanup();
    const {Panel} = createLazyPanel<{name: string}>(() =>
      Promise.reject(new Error('offline')),
    );
    render(boundary(<Panel name="Ada" />));
    expect(await screen.findByText('failed')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: 'Try again'}),
    ).not.toBeInTheDocument();
    stop();
  });
});

describe('<PanelFailed>', () => {
  it('offers a plain link when given an address, as an alert', () => {
    render(<PanelFailed href="/cart" linkText="Open the cart page" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByRole('link', {name: 'Open the cart page'}),
    ).toHaveAttribute('href', '/cart');
  });

  it('offers a reload button without one', () => {
    render(<PanelFailed linkText="Reload the page" />);
    expect(
      screen.getByRole('button', {name: 'Reload the page'}),
    ).toBeInTheDocument();
  });
});

describe('the ZIP dialog form chunk', () => {
  it('starts downloading when the shopper points at the ZIP button, and focuses the field on open', async () => {
    const preload = vi.spyOn(zipFormPanel, 'preload');
    render(
      <DeliveryZipControl zip={null} onSubmit={vi.fn()} onClear={vi.fn()} />,
    );
    const button = screen.getByRole('button', {name: /delivery ZIP/});
    fireEvent.pointerEnter(button);
    fireEvent.focus(button);
    expect(preload).toHaveBeenCalled();
    fireEvent.click(button);
    const field = await screen.findByRole('textbox', {name: 'ZIP code'});
    // Focus lands in the field (the dialog's initial focus, or the form's own correction when the chunk is late).
    await waitFor(() => expect(field).toHaveFocus());
  });
});
