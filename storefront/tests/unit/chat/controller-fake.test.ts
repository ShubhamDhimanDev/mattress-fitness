// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createChatController} from '~/lib/chat/controller';
import {FAKE_PANEL_ID, createFakeProvider} from '~/lib/chat/providers/fake';

// NFR-011 / NFR-013 (review M2): the real fake adapter, whose script arrives after the controller gave up on it.

const panel = () => document.getElementById(FAKE_PANEL_ID);

function setup(loadDelayMs: number) {
  Reflect.set(globalThis, '__CHAT_FAKE__', {loadDelayMs});
  return createChatController({
    create: () => Promise.resolve(createFakeProvider()),
    onFailure: () => {},
    loadTimeoutMs: 1000,
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  Reflect.deleteProperty(globalThis, '__CHAT_FAKE__');
});

describe('NFR-011 a widget that arrives after the timeout does not stay', () => {
  it('is removed when it finally appears, and the controller stays failed', async () => {
    const controller = setup(2000);
    controller.setAllowed(true);
    await vi.advanceTimersByTimeAsync(1001);
    expect(controller.getState().phase).toBe('failed');
    expect(panel()).toBeNull();
    // The script arrives at 2000 ms: it was added, and must have been taken out again.
    await vi.advanceTimersByTimeAsync(1100);
    expect(panel()).toBeNull();
    expect(controller.getState().phase).toBe('failed');
  });

  it('is removed when consent was withdrawn after the timeout and before it appeared', async () => {
    const controller = setup(2000);
    controller.setAllowed(true);
    await vi.advanceTimersByTimeAsync(1001);
    controller.setAllowed(false);
    await vi.advanceTimersByTimeAsync(1100);
    expect(panel()).toBeNull();
    expect(controller.getState().phase).toBe('waiting');
  });
});
