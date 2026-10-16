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
