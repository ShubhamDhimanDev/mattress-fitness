// A stand-in chat provider for development and tests (P7-03). It is NOT a vendor and loads nothing from the network: the
// "widget" is a small labelled panel in the page, so call-outs, focus return, consent withdrawal and failure handling
// can be exercised without an account. Reachable only through `registry.ts` behind `import.meta.env.DEV`, and refused
// by `parseChatConfig` outside development, so no production build offers a fake chat.
//
// Test controls (development only, read from `window.__CHAT_FAKE__` each time): `loadDelayMs`, `failLoad`,
// `openThrows`. A Playwright test sets it with `addInitScript`; there is no URL or storage hook.

import type {ChatProvider} from '~/lib/chat/provider';

export const FAKE_PANEL_ID = 'fake-chat-panel';
export const FAKE_CLOSE_LABEL = 'Close the test chat';

type FakeControls = {
  readonly loadDelayMs: number;
  readonly failLoad: boolean;
  readonly openThrows: boolean;
};

function readControls(target: object): FakeControls {
  const raw: unknown = Reflect.get(target, '__CHAT_FAKE__');
  const read = (key: string): unknown =>
    typeof raw === 'object' && raw !== null ? Reflect.get(raw, key) : undefined;
  const delay = read('loadDelayMs');
  return {
    loadDelayMs:
      typeof delay === 'number' && delay >= 0 && delay <= 30_000 ? delay : 0,
    failLoad: read('failLoad') === true,
    openThrows: read('openThrows') === true,
  };
}

export function createFakeProvider(
  doc: Document = document,
  controls: () => FakeControls = () => readControls(globalThis),
): ChatProvider {
  let panel: HTMLElement | null = null;
  let opener: Element | null = null;
  let pending: Promise<void> | null = null;

  function close(): void {
    if (panel) panel.hidden = true;
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    opener = null;
  }

  function build(): HTMLElement {
    const element = doc.createElement('div');
    element.id = FAKE_PANEL_ID;
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-label', 'Test chat');
    element.hidden = true;
    // Development stand-in only; set through the style object, which a style policy allows.
    Object.assign(element.style, {
      position: 'fixed',
      bottom: '1rem',
      right: '1rem',
      zIndex: '50',
      padding: '1rem',
      background: 'white',
      border: '1px solid black',
    });
    const text = doc.createElement('p');
    text.textContent = 'This is the development test chat.';
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = FAKE_CLOSE_LABEL;
    button.addEventListener('click', close);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
    element.append(text, button);
    return element;
  }

  return {
    id: 'fake',
    // Idempotent: a second call while loading returns the same promise, and a second call once loaded does nothing.
    load() {
      if (panel) return Promise.resolve();
      if (pending) return pending;
      const {loadDelayMs, failLoad} = controls();
      pending = new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          pending = null;
          if (failLoad) {
            reject(new Error('fake chat load failed'));
            return;
          }
          panel = build();
          doc.body.append(panel);
          resolve();
        }, loadDelayMs);
      });
      return pending;
    },
    isReady: () => panel !== null && panel.isConnected,
    open() {
      if (controls().openThrows) throw new Error('fake chat open failed');
      if (!panel) return;
      opener = doc.activeElement;
      panel.hidden = false;
      panel.querySelector('button')?.focus();
    },
    unload() {
      panel?.remove();
      panel = null;
      opener = null;
    },
  };
}
