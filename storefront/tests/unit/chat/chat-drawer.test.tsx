// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Aside, useAside} from '~/components/Aside';
import {MobileNav} from '~/components/layout/MobileNav';
import {UtilityBar} from '~/components/layout/UtilityBar';
import type {PublicChatConfig} from '~/lib/chat/config';
import {chatHandle} from '~/lib/chat/handle';
import {releaseChat} from '~/lib/chat/live';
import {FAKE_CLOSE_LABEL, FAKE_PANEL_ID} from '~/lib/chat/providers/fake';

// REQ-ANL-004 / NFR-003 (review M1): the call-out in the phone menu. The drawer closes and gives focus back FIRST, then
// the widget opens and takes focus; the messages are spoken by a page-level region (the menu unmounts when it closes
// and the header bar is hidden below 1024 px).

const config: PublicChatConfig = {providerId: 'fake', requiresConsent: false};
const links = [
  {id: 'contact', label: 'Contact us', to: '/pages/contact'},
  {id: 'chat', label: 'Chat with us', to: '/pages/contact', chat: config},
];
const idle: Array<() => void> = [];

function MenuToggle() {
  const {open} = useAside();
  return (
    <button type="button" onClick={() => open('mobile')}>
      Menu
    </button>
  );
}

function Drawer() {
  const {close} = useAside();
  return (
    <Aside type="mobile" heading="Menu" side="left">
      <MobileNav items={[]} onNavigate={close} utilityLinks={links} />
    </Aside>
  );
}

function Page() {
  return (
    <MemoryRouter>
      <Aside.Provider>
        <UtilityBar links={links}>
          <span>left</span>
        </UtilityBar>
        <MenuToggle />
        <Drawer />
      </Aside.Provider>
    </MemoryRouter>
  );
}

async function ready() {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await act(async () => {
    idle.splice(0).forEach((callback) => callback());
  });
  await waitFor(() =>
    expect(
      screen.getAllByRole('button', {name: 'Chat with us'}).length,
    ).toBeGreaterThan(0),
  );
}

async function pressChatInDrawer() {
  const menu = screen.getByRole('button', {name: 'Menu'});
  menu.focus(); // a click focuses the button in a browser; the drawer gives focus back to it on close
  fireEvent.click(menu);
  const drawer = await screen.findByRole('dialog', {name: 'Menu'});
  const button = await within(drawer).findByRole('button', {
    name: 'Chat with us',
  });
  button.focus();
  fireEvent.click(button);
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
  Reflect.deleteProperty(window, 'requestIdleCallback');
  Reflect.deleteProperty(window, 'cancelIdleCallback');
  Reflect.deleteProperty(window, '__CHAT_FAKE__');
  document.getElementById(FAKE_PANEL_ID)?.remove();
});

describe('REQ-ANL-004 chat opened from the phone menu', () => {
  it('opens only after the drawer is gone, and the widget (not the menu button) holds focus', async () => {
    render(<Page />);
    await ready();
    const original = chatHandle.open;
    const seen: Array<{overlayGone: boolean; anythingInert: boolean}> = [];
    vi.spyOn(chatHandle, 'open').mockImplementation(() => {
      seen.push({
        overlayGone: document.querySelector('[data-overlay-host]') === null,
        anythingInert: document.querySelector('[inert]') !== null,
      });
      original();
    });
    await pressChatInDrawer();
    const closeButton = await screen.findByRole('button', {
      name: FAKE_CLOSE_LABEL,
    });
    await waitFor(() => expect(document.activeElement).toBe(closeButton));
    expect(seen).toEqual([{overlayGone: true, anythingInert: false}]);
    expect(screen.queryByRole('dialog', {name: 'Menu'})).toBeNull();
    expect(document.activeElement).not.toBe(
      screen.getByRole('button', {name: 'Menu'}),
    );
  });

  it('pressed before the widget is ready: "Starting chat." is spoken by the page-level region, then the widget opens', async () => {
    Reflect.set(window, '__CHAT_FAKE__', {loadDelayMs: 3000});
    render(<Page />);
    await ready();
    await pressChatInDrawer();
    expect(screen.queryByRole('dialog', {name: 'Menu'})).toBeNull();
    // The open request is made once the drawer has closed, so the message follows the close.
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Starting chat.'),
    );
    const closeButton = await screen.findByRole(
      'button',
      {name: FAKE_CLOSE_LABEL},
      {timeout: 9000},
    );
    await waitFor(() => expect(document.activeElement).toBe(closeButton));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('a failure after a press from the menu is announced and shows the notice with the contact page', async () => {
    Reflect.set(window, '__CHAT_FAKE__', {failLoad: true, loadDelayMs: 3000});
    render(<Page />);
    await ready();
    await pressChatInDrawer();
    const link = await screen.findByRole(
      'link',
      {name: 'Contact us instead'},
      {timeout: 9000},
    );
    expect(link.getAttribute('href')).toBe('/pages/contact');
    expect(screen.getByRole('status').textContent).toBe(
      'Chat is unavailable right now.',
    );
    // The menu button got focus back when the drawer closed; the notice does not take it from there.
    expect(document.activeElement).toBe(
      screen.getByRole('button', {name: 'Menu'}),
    );
  });
});
