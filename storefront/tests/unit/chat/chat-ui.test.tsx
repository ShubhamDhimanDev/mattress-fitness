// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {StrictMode} from 'react';
import {MemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {UtilityBar} from '~/components/layout/UtilityBar';
import {createConsentStore} from '~/lib/analytics/consent-store';
import {consentHandle} from '~/lib/analytics/gate';
import type {PublicChatConfig} from '~/lib/chat/config';
import {chatHandle} from '~/lib/chat/handle';
import {releaseChat} from '~/lib/chat/live';
import {FAKE_CLOSE_LABEL, FAKE_PANEL_ID} from '~/lib/chat/providers/fake';

// REQ-ANL-004 (call-outs open the provider, consent, no dead button), NFR-011 (consent withdrawal), NFR-013 (provider
// failure hides chat only), NFR-003 (button, name, live region, focus). The real lazy chunk and gate run against the
// development fake provider; only the browser's idle callback is driven by the test.

const idle: Array<() => void> = [];
const gated: PublicChatConfig = {providerId: 'fake', requiresConsent: true};
const open: PublicChatConfig = {providerId: 'fake', requiresConsent: false};

function consentStore() {
  const store = createConsentStore({
    mode: 'opt-in',
    storage: {read: () => null, write: () => {}},
  });
  consentHandle.publish(store);
  // What the consent chunk does: the shell hears about every change of the choice.
  store.subscribe(consentHandle.notify);
  return store;
}

async function flushIdle() {
  await shellLoaded();
  await act(async () => {
    const callbacks = idle.splice(0);
    callbacks.forEach((callback) => callback());
  });
}

/** The header bar as the root renders it: the chat entry carries the provider's config, or is absent. */
function Page({
  config,
  contact = true,
}: {
  config: PublicChatConfig | null;
  contact?: boolean;
}) {
  const links = [
    {id: 'track', label: 'Track order', to: '/track-order'},
    ...(contact
      ? [{id: 'contact', label: 'Contact us', to: '/pages/contact'}]
      : []),
    ...(config
      ? [
          {
            id: 'chat',
            label: 'Chat with us',
            to: '/pages/contact',
            chat: config,
          },
        ]
      : []),
  ];
  return (
    <MemoryRouter>
      <button type="button">Elsewhere</button>
      <UtilityBar links={links}>
        <span>left</span>
      </UtilityBar>
    </MemoryRouter>
  );
}

/** The lazy chat chunk has loaded; only then has its gate asked the browser for idle time. */
async function shellLoaded() {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

function chatButton() {
  return screen.findByRole('button', {name: 'Chat with us'});
}

beforeEach(() => {
  idle.length = 0;
  Reflect.set(window, 'requestIdleCallback', (callback: () => void) => {
    idle.push(callback);
    return idle.length;
  });
  Reflect.set(window, 'cancelIdleCallback', () => {});
});

afterEach(() => {
  cleanup();
  releaseChat();
  chatHandle.reset();
  consentHandle.publish(null);
  Reflect.deleteProperty(window, 'requestIdleCallback');
  Reflect.deleteProperty(window, 'cancelIdleCallback');
  Reflect.deleteProperty(window, '__CHAT_FAKE__');
  document.getElementById(FAKE_PANEL_ID)?.remove();
});

describe('REQ-ANL-004 / NFR-011 consent gate', () => {
  it('loads nothing and shows nothing until the shopper allows analytics', async () => {
    consentStore();
    render(<Page config={gated} />);
    await flushIdle();
    expect(idle).toHaveLength(0);
    expect(screen.queryByRole('button', {name: 'Chat with us'})).toBeNull();
    expect(document.getElementById(FAKE_PANEL_ID)).toBeNull();
  });

  it('does not treat the marketing category as consent for chat', async () => {
    const store = consentStore();
    render(<Page config={gated} />);
    act(() => store.save({analytics: false, marketing: true}));
    await flushIdle();
    expect(screen.queryByRole('button', {name: 'Chat with us'})).toBeNull();
    expect(document.getElementById(FAKE_PANEL_ID)).toBeNull();
  });

  it('shows the call-out after analytics is allowed and the browser is idle', async () => {
    const store = consentStore();
    render(<Page config={gated} />);
    act(() => store.acceptAll());
    await flushIdle();
    expect(await chatButton()).toBeTruthy();
    await waitFor(() =>
      expect(document.getElementById(FAKE_PANEL_ID)).not.toBeNull(),
    );
  });

  it('withdrawal unloads the widget and takes the call-out away', async () => {
    const store = consentStore();
    render(<Page config={gated} />);
    act(() => store.acceptAll());
    await flushIdle();
    await chatButton();
    act(() => store.rejectAll());
    expect(screen.queryByRole('button', {name: 'Chat with us'})).toBeNull();
    expect(document.getElementById(FAKE_PANEL_ID)).toBeNull();
    act(() => store.acceptAll());
    expect(await chatButton()).toBeTruthy();
  });

  it('with consent not required, loads on idle without any consent layer', async () => {
    render(<Page config={open} />);
    expect(screen.queryByRole('button', {name: 'Chat with us'})).toBeNull();
    await flushIdle();
    expect(await chatButton()).toBeTruthy();
  });
});

describe('REQ-ANL-004 call-out behaviour', () => {
  it('is a real button with an accessible name; pressing it opens the widget and moves focus in', async () => {
    render(<Page config={open} />);
    await flushIdle();
    const button = await chatButton();
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', {name: 'Test chat'});
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('focus returns to the call-out when the widget closes', async () => {
    render(<Page config={open} />);
    await flushIdle();
    const button = await chatButton();
    button.focus();
    fireEvent.click(button);
    fireEvent.click(
      await screen.findByRole('button', {name: FAKE_CLOSE_LABEL}),
    );
    expect(document.activeElement).toBe(button);
  });

  it('pressed before the widget is ready: announces starting, marks busy, then opens', async () => {
    Reflect.set(window, '__CHAT_FAKE__', {loadDelayMs: 150});
    render(<Page config={open} />);
    await flushIdle();
    const button = await chatButton();
    expect(button.getAttribute('aria-busy')).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Starting chat.');
    expect(await screen.findByRole('dialog', {name: 'Test chat'})).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
    expect(button.getAttribute('aria-busy')).toBeNull();
  });

  it('a widget that throws on open says so and stays usable', async () => {
    render(<Page config={open} />);
    await flushIdle();
    const button = await chatButton();
    Reflect.set(window, '__CHAT_FAKE__', {openThrows: true});
    fireEvent.click(button);
    expect(screen.getByRole('status').textContent).toBe(
      'Chat could not be opened. Please try again.',
    );
    expect(screen.getByRole('button', {name: 'Chat with us'})).toBeTruthy();
  });
});

describe('NFR-013 provider failure hides chat only', () => {
  it('a passive failure leaves no call-out, no empty list item, no notice and nothing to announce', async () => {
    Reflect.set(window, '__CHAT_FAKE__', {failLoad: true});
    render(<Page config={open} />);
    await flushIdle();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole('button', {name: 'Chat with us'})).toBeNull();
    expect(
      screen.queryByRole('link', {name: /chat|contact us instead/i}),
    ).toBeNull();
    expect(screen.queryByRole('button', {name: 'Dismiss'})).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
    // Only the ordinary links remain ("Find a store" and the two given ones): no empty item where the call-out was.
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('after the shopper pressed it, a failure removes the button, announces, shows a notice with the contact page, and focus is not lost', async () => {
    Reflect.set(window, '__CHAT_FAKE__', {failLoad: true, loadDelayMs: 100});
    render(<Page config={open} />);
    await flushIdle();
    const button = await chatButton();
    button.focus();
    fireEvent.click(button);
    const link = await screen.findByRole('link', {name: 'Contact us instead'});
    expect(link.getAttribute('href')).toBe('/pages/contact');
    expect(screen.queryByRole('button', {name: 'Chat with us'})).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(
      'Chat is unavailable right now.',
    );
    // The pressed button went away with focus on it; focus moves to the notice instead of falling to the page (n4).
    const notice = link.closest<HTMLElement>('[tabindex="-1"]');
    expect(notice).not.toBeNull();
    expect(document.activeElement).toBe(notice);
  });

  it('a failure that arrives after the shopper moved on does not take focus', async () => {
    Reflect.set(window, '__CHAT_FAKE__', {failLoad: true, loadDelayMs: 100});
    render(<Page config={open} />);
    await flushIdle();
    fireEvent.click(await chatButton());
    const elsewhere = screen.getByRole('button', {name: 'Elsewhere'});
    elsewhere.focus();
    await screen.findByRole('link', {name: 'Contact us instead'});
    expect(document.activeElement).toBe(elsewhere);
  });

  it('with no contact page the notice has no link (never a dead one) and can be dismissed', async () => {
    Reflect.set(window, '__CHAT_FAKE__', {failLoad: true, loadDelayMs: 100});
    render(<Page config={open} contact={false} />);
    await flushIdle();
    fireEvent.click(await chatButton());
    const dismiss = await screen.findByRole('button', {name: 'Dismiss'});
    expect(
      screen.queryByRole('link', {name: /contact us instead/i}),
    ).toBeNull();
    expect(screen.queryByRole('button', {name: 'Chat with us'})).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(
      'Chat is unavailable right now.',
    );
    fireEvent.click(dismiss);
    expect(screen.queryByRole('button', {name: 'Dismiss'})).toBeNull();
  });

  it('a widget that cannot be opened shows the notice too, and the button stays', async () => {
    render(<Page config={open} />);
    await flushIdle();
    const button = await chatButton();
    Reflect.set(window, '__CHAT_FAKE__', {openThrows: true});
    fireEvent.click(button);
    expect(await screen.findByRole('button', {name: 'Dismiss'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Chat with us'})).toBeTruthy();
  });
});

describe('REQ-ANL-004 remount adoption (StrictMode, ErrorBoundary swap)', () => {
  it('StrictMode loads the provider once', async () => {
    render(
      <StrictMode>
        <Page config={open} />
      </StrictMode>,
    );
    await flushIdle();
    await chatButton();
    expect(document.querySelectorAll(`#${FAKE_PANEL_ID}`)).toHaveLength(1);
  });

  it('a second mount adopts the running controller: one widget, call-out back at once', async () => {
    const first = render(<Page config={open} />);
    await flushIdle();
    await chatButton();
    first.unmount();
    expect(screen.queryByRole('button', {name: 'Chat with us'})).toBeNull();
    render(<Page config={open} />);
    await flushIdle();
    expect(await chatButton()).toBeTruthy();
    expect(document.querySelectorAll(`#${FAKE_PANEL_ID}`)).toHaveLength(1);
  });
});

describe('REQ-ANL-004 header integration', () => {
  it('UtilityBar renders the chat entry as a button after the other links, and nothing while hidden', async () => {
    render(<Page config={open} />);
    expect(screen.queryByText('Chat with us')).toBeNull();
    // The bar always lists "Find a store" first (CR-31), then the links it was given.
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    await flushIdle();
    expect(await chatButton()).toBeTruthy();
    expect(screen.queryByRole('link', {name: 'Chat with us'})).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('a chat entry without a configuration (the boolean form) renders nothing: never the old stand-in link', async () => {
    render(
      <MemoryRouter>
        <UtilityBar
          links={[
            {id: 'contact', label: 'Contact us', to: '/pages/contact'},
            {id: 'chat', label: 'Chat with us', to: '/pages/contact'},
          ]}
        >
          <span>left</span>
        </UtilityBar>
      </MemoryRouter>,
    );
    await shellLoaded();
    expect(screen.queryByText('Chat with us')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
