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
  const tawk = config.tawk;
  const ids = tawk ? `${tawk.propertyId}/${tawk.widgetId}` : '';
  return `${config.providerId}|${config.requiresConsent}|${ids}`;
}

export function acquireChat(config: PublicChatConfig): ChatController {
  const key = keyOf(config);
  if (live && live.key === key) return live.controller;
  releaseChat();
  const controller = createChatController({
    create: () => createChatProvider(config),
    // Fixed words: which provider and which step. Written to the shopper's browser console, like the analytics lines.
    onFailure: (reason) =>
      logWarn('chat.provider_failed', {provider: config.providerId, reason}),
  });
  live = {key, controller};
  return controller;
}

// A real unmount of the chat component (not StrictMode's immediate second run, not the error-page swap, which mount again
// in the same commit) must still deliver a consent withdrawal: with nothing mounted, no effect would ever tell the
// controller. So the unmount schedules "no longer allowed" for the next macrotask, and a mount that adopts the controller
// before then cancels it. The mount that follows tells the controller the truth again.
let pendingWithdrawal: ReturnType<typeof setTimeout> | null = null;

export function cancelDeferredWithdrawal(): void {
  if (pendingWithdrawal !== null) clearTimeout(pendingWithdrawal);
  pendingWithdrawal = null;
}

export function deferWithdrawal(controller: ChatController): void {
  cancelDeferredWithdrawal();
  pendingWithdrawal = setTimeout(() => {
    pendingWithdrawal = null;
    controller.setAllowed(false);
  }, 0);
}

/** Stops the running controller (a changed configuration, or a test starting over). */
export function releaseChat(): void {
  cancelDeferredWithdrawal();
  const current = live;
  if (!current) return;
  live = null;
  current.controller.stop();
}
