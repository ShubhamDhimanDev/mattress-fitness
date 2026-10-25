// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {CHAT_PROVIDER_FACTORIES, createChatProvider} from '~/lib/chat/registry';
import {
  FAKE_CLOSE_LABEL,
  FAKE_PANEL_ID,
  createFakeProvider,
} from '~/lib/chat/providers/fake';

// REQ-ANL-004: the registry only knows adapters that exist; the development fake behaves like a widget (loads, opens,
// returns focus, unloads) so the call-outs can be proved without an account.

describe('REQ-ANL-004 registry', () => {
  it('knows no production adapter: an empty table gives null, never a throw', async () => {
    await expect(createChatProvider('fake', {})).resolves.toBeNull();
  });

  it('builds the fake in a development build (import.meta.env.DEV is true under Vitest)', async () => {
    expect(Object.keys(CHAT_PROVIDER_FACTORIES)).toEqual(['fake']);
    const provider = await createChatProvider('fake');
    expect(provider?.id).toBe('fake');
  });
});

describe('REQ-ANL-004 fake provider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    Reflect.deleteProperty(globalThis, '__CHAT_FAKE__');
  });

  it('is not ready before load, ready after, and adds one labelled dialog', async () => {
    const provider = createFakeProvider();
    expect(provider.isReady()).toBe(false);
    const loaded = provider.load();
    await vi.advanceTimersByTimeAsync(0);
    await loaded;
    expect(provider.isReady()).toBe(true);
    const panel = document.getElementById(FAKE_PANEL_ID);
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(panel?.getAttribute('aria-label')).toBe('Test chat');
    expect(panel?.hidden).toBe(true);
  });

  it('load is idempotent, also while a load is in flight', async () => {
    Reflect.set(globalThis, '__CHAT_FAKE__', {loadDelayMs: 50});
    const provider = createFakeProvider();
    const first = provider.load();
    const second = provider.load();
    await vi.advanceTimersByTimeAsync(60);
    await Promise.all([first, second]);
    expect(document.querySelectorAll(`#${FAKE_PANEL_ID}`)).toHaveLength(1);
    await provider.load();
    expect(document.querySelectorAll(`#${FAKE_PANEL_ID}`)).toHaveLength(1);
  });

  it('can be told to fail, with a bounded delay only', async () => {
    Reflect.set(globalThis, '__CHAT_FAKE__', {
      failLoad: true,
      loadDelayMs: 99999,
    });
    const provider = createFakeProvider();
    const loaded = provider.load();
    const settled = expect(loaded).rejects.toThrow('fake chat load failed');
    await vi.advanceTimersByTimeAsync(0);
    await settled;
    expect(provider.isReady()).toBe(false);
  });

  it('opens, moves focus into the dialog and returns it to the opener on close and on Escape', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    const provider = createFakeProvider();
    const loaded = provider.load();
    await vi.advanceTimersByTimeAsync(0);
    await loaded;
    for (const close of ['button', 'escape'] as const) {
      opener.focus();
      provider.open();
      const panel = document.getElementById(FAKE_PANEL_ID);
      expect(panel?.hidden).toBe(false);
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent === FAKE_CLOSE_LABEL,
      );
      expect(document.activeElement).toBe(button);
      if (close === 'button') button?.click();
      else {
        button?.dispatchEvent(
          new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}),
        );
      }
      expect(panel?.hidden).toBe(true);
      expect(document.activeElement).toBe(opener);
    }
  });

  it('open can be told to throw; unload removes the dialog', async () => {
    const provider = createFakeProvider();
    const loaded = provider.load();
    await vi.advanceTimersByTimeAsync(0);
    await loaded;
    Reflect.set(globalThis, '__CHAT_FAKE__', {openThrows: true});
    expect(() => provider.open()).toThrow('fake chat open failed');
    provider.unload?.();
    expect(provider.isReady()).toBe(false);
    expect(document.getElementById(FAKE_PANEL_ID)).toBeNull();
  });

  it.each([-5, 31_000, 'soon', null, Number.NaN])(
    'ignores a hostile delay %j',
    async (delay) => {
      Reflect.set(globalThis, '__CHAT_FAKE__', {loadDelayMs: delay});
      const provider = createFakeProvider();
      const loaded = provider.load();
      await vi.advanceTimersByTimeAsync(0);
      await loaded;
      expect(provider.isReady()).toBe(true);
    },
  );
});
