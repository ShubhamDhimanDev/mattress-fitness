// The one running chat controller of the page (P7-03), adopted by every remount, like `~/lib/analytics/live`.
//
// The root renders its own page layout in the App and another in the ErrorBoundary, and React StrictMode runs effects
// twice, so the chat component can unmount and mount again during one visit. The controller, and so the provider and
// its script, must not follow it: a second one would load the vendor's script twice. A remount adopts this one.

import {createChatController, type ChatController} from '~/lib/chat/controller';
import type {PublicChatConfig} from '~/lib/chat/config';
import {createChatProvider} from '~/lib/chat/registry';
import {logWarn} from '~/lib/logging/logger';

type Held = {readonly key: string; readonly controller: ChatController};

let live: Held | null = null;

function keyOf(config: PublicChatConfig): string {
  return `${config.providerId}|${config.requiresConsent}`;
}

export function acquireChat(config: PublicChatConfig): ChatController {
  const key = keyOf(config);
  if (live && live.key === key) return live.controller;
  releaseChat();
  const controller = createChatController({
    create: () => createChatProvider(config.providerId),
    // Fixed words: which provider and which step. Written to the shopper's browser console, like the analytics lines.
    onFailure: (reason) =>
      logWarn('chat.provider_failed', {provider: config.providerId, reason}),
  });
  live = {key, controller};
  return controller;
}

/** Stops the running controller (a changed configuration, or a test starting over). */
export function releaseChat(): void {
  const current = live;
  if (!current) return;
  live = null;
  current.controller.stop();
}
