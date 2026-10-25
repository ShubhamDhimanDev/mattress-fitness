// @vitest-environment jsdom
import {act, cleanup, render} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {ChatRuntime} from '~/components/chat/ChatRuntime';
import type {PublicChatConfig} from '~/lib/chat/config';
import {chatHandle} from '~/lib/chat/handle';
import {acquireChat, releaseChat} from '~/lib/chat/live';
import {FAKE_PANEL_ID} from '~/lib/chat/providers/fake';

// NFR-011 (review m3): when the chat component goes away for good, a withdrawal still reaches the live controller; a
// mount that follows at once (StrictMode, the error-page swap) keeps it.

const config: PublicChatConfig = {providerId: 'fake', requiresConsent: false};
const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

afterEach(() => {
  cleanup();
  releaseChat();
  chatHandle.reset();
  document.getElementById(FAKE_PANEL_ID)?.remove();
});

function mount(allowed: boolean) {
  return render(
    <ChatRuntime
      config={config}
      allowed={allowed}
      publish={chatHandle.publish}
    />,
  );
}

describe('REQ-ANL-004 ChatRuntime unmount', () => {
  it('a real unmount withdraws the controller on the next macrotask and removes the widget', async () => {
    const view = mount(true);
    await tick();
    expect(acquireChat(config).getState().phase).toBe('ready');
    expect(document.getElementById(FAKE_PANEL_ID)).not.toBeNull();
    view.unmount();
    // Not yet: the withdrawal is scheduled for the next macrotask, so an immediate mount can cancel it.
    expect(acquireChat(config).getState().phase).toBe('ready');
    await tick();
    expect(acquireChat(config).getState().phase).toBe('waiting');
    expect(document.getElementById(FAKE_PANEL_ID)).toBeNull();
  });

  it('a mount that adopts the controller before then cancels the withdrawal', async () => {
    const first = mount(true);
    await tick();
    first.unmount();
    mount(true);
    await tick();
    expect(acquireChat(config).getState().phase).toBe('ready');
    expect(document.querySelectorAll(`#${FAKE_PANEL_ID}`)).toHaveLength(1);
  });

  it('a remount whose consent is gone withdraws', async () => {
    const first = mount(true);
    await tick();
    first.unmount();
    mount(false);
    await tick();
    expect(acquireChat(config).getState().phase).toBe('waiting');
    expect(document.getElementById(FAKE_PANEL_ID)).toBeNull();
  });
});
