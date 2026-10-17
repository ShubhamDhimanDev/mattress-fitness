// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {Suspense, type ComponentType} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  createLazyPanel,
  LazyBoundary,
  PanelFailed,
  RETRY_AFTER_FAILURE_MS,
} from '~/components/layout/LazyPanel';
import {DeliveryZipControl} from '~/components/layout/DeliveryZipControl';
import {zipFormPanel} from '~/components/layout/lazyPanels';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * Silences what React and jsdom print for a render error that a boundary is meant to catch, for the length of one
 * test body, and always puts the console and the window back (a failed assertion must not leave them muted).
 */
async function quietly(run: () => Promise<void> | void): Promise<void> {
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  // React reports the render error to the window as well; jsdom would print it.
  const swallow = (event: ErrorEvent) => event.preventDefault();
  window.addEventListener('error', swallow);
  try {
    await run();
  } finally {
    window.removeEventListener('error', swallow);
    consoleError.mockRestore();
  }
}

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

function failingThenWorking(failures: number) {
  const load = vi.fn<() => Promise<typeof Greeting>>();
  for (let i = 0; i < failures; i += 1) {
    load.mockRejectedValueOnce(new Error('offline'));
  }
  load.mockResolvedValue(Greeting);
  return load;
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

  it('shows the failure fallback instead of throwing, and a preload failure is silent', () =>
    quietly(async () => {
      const {Panel, preload} = createLazyPanel<{name: string}>(() =>
        Promise.reject(new Error('chunk 404')),
      );
      await expect(preload()).resolves.toBeUndefined();
      render(boundary(<Panel name="Ada" />));
      expect(await screen.findByText('failed')).toBeInTheDocument();
    }));
});

// QA-P7-L3: a handler that preloads on every keystroke (the search field) must not send a request per keystroke while
// the network is down, and a later success must be visible to whoever shows the failure.
describe('preload after a failure (QA-P7-L3)', () => {
  it('ignores preloads for five seconds after a failure, then tries again once', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    const load = failingThenWorking(1);
    const {preload} = createLazyPanel(load);
    await preload();
    expect(load).toHaveBeenCalledTimes(1);

    // A burst of keystrokes right after the failure: no request.
    for (let i = 0; i < 20; i += 1) await preload();
    expect(load).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + RETRY_AFTER_FAILURE_MS - 1);
    await preload();
    expect(load).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1);
    await preload();
    expect(load).toHaveBeenCalledTimes(2);
    // Loaded now: further preloads never download again.
    await preload();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a failure that persists is retried at most once per interval', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    const load = vi
      .fn<() => Promise<typeof Greeting>>()
      .mockRejectedValue(new Error('offline'));
    const {preload} = createLazyPanel(load);
    await preload();
    for (let round = 1; round <= 3; round += 1) {
      vi.setSystemTime(Date.now() + RETRY_AFTER_FAILURE_MS);
      for (let i = 0; i < 10; i += 1) await preload();
      expect(load).toHaveBeenCalledTimes(1 + round);
    }
  });

  it('mounting the panel is a new attempt even inside the interval', () =>
    quietly(async () => {
      vi.useFakeTimers({toFake: ['Date']});
      const load = failingThenWorking(1);
      const {Panel, preload} = createLazyPanel<{name: string}>(load);
      await preload();
      render(boundary(<Panel name="Ada" />));
      expect(await screen.findByText('Hello Ada')).toBeInTheDocument();
      expect(load).toHaveBeenCalledTimes(2);
    }));

  it('reports its status to subscribers: failed, then loaded when a later download succeeds', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    const {preload, getStatus, subscribe} = createLazyPanel(
      failingThenWorking(1),
    );
    const seen: string[] = [];
    const unsubscribe = subscribe(() => seen.push(getStatus()));
    expect(getStatus()).toBe('pending');

    await preload();
    expect(getStatus()).toBe('failed');
    vi.setSystemTime(Date.now() + RETRY_AFTER_FAILURE_MS);
    await preload();
    expect(getStatus()).toBe('loaded');
    expect(seen).toEqual(['failed', 'loaded']);

    unsubscribe();
    await preload();
    expect(seen).toEqual(['failed', 'loaded']);
  });
});

describe('a panel rendered outside a LazyBoundary', () => {
  function bare(name: string, Panel: ComponentType<{name: string}>) {
    return (
      <Suspense fallback={<p>loading</p>}>
        <Panel name={name} />
      </Suspense>
    );
  }

  it('warns once in development that a failed download cannot be retried', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const {Panel} = createLazyPanel(() => Promise.resolve(Greeting));
      const view = render(bare('Ada', Panel));
      expect(await screen.findByText('Hello Ada')).toBeInTheDocument();
      view.rerender(bare('Grace', Panel));
      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(
        messages.filter((message) =>
          message.includes('lazy_panel.without_boundary'),
        ),
      ).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn inside a boundary', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const {Panel} = createLazyPanel(() => Promise.resolve(Greeting));
      render(boundary(<Panel name="Ada" />));
      expect(await screen.findByText('Hello Ada')).toBeInTheDocument();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

// QA-P7-L1: React.lazy keeps a rejected result, so the helper must hand out a fresh lazy component after a failure
// and the boundary must be able to mount the panel again in place.
describe('recovery after a failed download (QA-P7-L1)', () => {
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

  it('shows the panel on the next mount (the shopper reopens it) when the first download failed', () =>
    quietly(async () => {
      const load = failingThenWorking(1);
      const {Panel} = createLazyPanel<{name: string}>(load);
      const first = render(boundary(<Panel name="Ada" />));
      expect(await screen.findByText('failed')).toBeInTheDocument();
      first.unmount();

      render(boundary(<Panel name="Ada" />));
      expect(await screen.findByText('Hello Ada')).toBeInTheDocument();
      expect(load).toHaveBeenCalledTimes(2);
    }));

  it('"Try again" downloads the panel again in place and renders it', () =>
    quietly(async () => {
      const load = failingThenWorking(1);
      const {Panel} = createLazyPanel<{name: string}>(load);
      render(withFailure(<Panel name="Ada" />));
      const retry = await screen.findByRole('button', {name: 'Try again'});
      fireEvent.click(retry);
      expect(await screen.findByText('Hello Ada')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(load).toHaveBeenCalledTimes(2);
    }));

  it('a second failure shows the fallback link again, still with "Try again", and a third attempt can succeed', () =>
    quietly(async () => {
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
    }));

  it('offers no "Try again" outside a boundary, and a boundary whose fallback is not PanelFailed adds none', () =>
    quietly(async () => {
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
    }));
});

// WCAG 2.4.3 for the drawers and dialogs that hold a panel: pressing "Try again" removes the pressed button, so focus
// goes to the dialog container at once and then to the first tabbable element in the dialog when the panel is back.
describe('focus after "Try again" inside a dialog (QA-P7-L1)', () => {
  function InDialog({children}: {children: React.ReactNode}) {
    return (
      <div role="dialog" aria-label="Sample dialog" tabIndex={-1}>
        <button type="button">Close</button>
        {children}
      </div>
    );
  }

  function inDialog(panel: React.ReactNode) {
    return (
      <>
        <button type="button">Outside</button>
        <InDialog>
          <LazyBoundary
            loading={<p>loading</p>}
            failed={<PanelFailed linkText="Reload the page" />}
          >
            {panel}
          </LazyBoundary>
        </InDialog>
      </>
    );
  }

  const dialog = () => screen.getByRole('dialog', {name: 'Sample dialog'});

  it('moves focus from the dialog container to the first tabbable element once the panel is shown', () =>
    quietly(async () => {
      const {Panel} = createLazyPanel<{name: string}>(failingThenWorking(1));
      render(inDialog(<Panel name="Ada" />));
      fireEvent.click(await screen.findByRole('button', {name: 'Try again'}));
      expect(await screen.findByText('Hello Ada')).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole('button', {name: 'Close'})).toHaveFocus(),
      );
      expect(dialog()).not.toHaveFocus();
    }));

  it('leaves focus on a field the panel focused itself (the ZIP form does this)', () =>
    quietly(async () => {
      function FieldPanel() {
        return (
          // eslint-disable-next-line jsx-a11y/no-autofocus -- stands in for the ZIP form's own focus correction
          <input aria-label="ZIP code" autoFocus />
        );
      }
      let calls = 0;
      const {Panel} = createLazyPanel<object>(() => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('offline'))
          : Promise.resolve(FieldPanel);
      });
      render(inDialog(<Panel />));
      fireEvent.click(await screen.findByRole('button', {name: 'Try again'}));
      const field = await screen.findByRole('textbox', {name: 'ZIP code'});
      await waitFor(() => expect(field).toHaveFocus());
      expect(screen.getByRole('button', {name: 'Close'})).not.toHaveFocus();
    }));

  it('does not take focus from an element the shopper moved to while the download was running', () =>
    quietly(async () => {
      let release: (component: typeof Greeting) => void = () => undefined;
      const load = vi
        .fn<() => Promise<typeof Greeting>>()
        .mockRejectedValueOnce(new Error('offline'))
        .mockImplementation(
          () => new Promise((resolve) => (release = resolve)),
        );
      const {Panel} = createLazyPanel<{name: string}>(load);
      render(inDialog(<Panel name="Ada" />));
      fireEvent.click(await screen.findByRole('button', {name: 'Try again'}));
      await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
      expect(dialog()).toHaveFocus();
      screen.getByRole('button', {name: 'Outside'}).focus();
      release(Greeting);
      expect(await screen.findByText('Hello Ada')).toBeInTheDocument();
      expect(screen.getByRole('button', {name: 'Outside'})).toHaveFocus();
    }));

  it('does not take focus when the panel fails to render long after a good retry', () =>
    quietly(async () => {
      function Fragile({explode}: {explode: boolean}) {
        if (explode) throw new Error('render error');
        return <p>fine</p>;
      }
      let calls = 0;
      const {Panel} = createLazyPanel<{explode: boolean}>(() => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('offline'))
          : Promise.resolve(Fragile);
      });
      const view = render(inDialog(<Panel explode={false} />));
      fireEvent.click(await screen.findByRole('button', {name: 'Try again'}));
      expect(await screen.findByText('fine')).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole('button', {name: 'Close'})).toHaveFocus(),
      );

      // The shopper carries on; later the panel throws while rendering. The failure message appears, but it must
      // not pull focus as it did right after the retry.
      view.rerender(inDialog(<Panel explode />));
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('button', {name: 'Try again'})).not.toHaveFocus();
      expect(screen.getByRole('button', {name: 'Close'})).toHaveFocus();
    }));

  it('a retry that fails again hands focus to the new "Try again"', () =>
    quietly(async () => {
      const {Panel} = createLazyPanel<{name: string}>(failingThenWorking(2));
      render(inDialog(<Panel name="Ada" />));
      fireEvent.click(await screen.findByRole('button', {name: 'Try again'}));
      await waitFor(() =>
        expect(screen.getByRole('button', {name: 'Try again'})).toHaveFocus(),
      );
    }));

  it('keeps a retry made outside any dialog working (no container to hand focus back to)', () =>
    quietly(async () => {
      const {Panel} = createLazyPanel<{name: string}>(failingThenWorking(1));
      render(
        <LazyBoundary
          loading={<p>loading</p>}
          failed={<PanelFailed linkText="Reload the page" />}
        >
          <Panel name="Ada" />
        </LazyBoundary>,
      );
      fireEvent.click(await screen.findByRole('button', {name: 'Try again'}));
      expect(await screen.findByText('Hello Ada')).toBeInTheDocument();
    }));
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
    try {
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
    } finally {
      preload.mockRestore();
    }
  });
});
