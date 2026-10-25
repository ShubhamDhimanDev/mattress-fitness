import type {consentHandle} from '~/lib/analytics/gate';
import type {PublicChatConfig} from '~/lib/chat/config';
import type {UtilityLink} from '~/lib/navigation';
import type {ChatView} from '~/lib/chat/view';

// Types only: nothing here reaches a bundle.

/**
 * What the header's chat entry hands the lazy chunk so the chunk can read the consent choice. It arrives as a prop instead
 * of the chunk importing it: a module imported by both the initial JavaScript and a lazy chunk becomes a chunk of its own
 * that every route downloads separately (measured 2026-10-25: one more file and about 170 bytes on every route).
 */
export type ChatConsent = Pick<
  typeof consentHandle,
  'subscribe' | 'getVersion' | 'getServerVersion' | 'getStore'
>;

/** What `ChatShell` hands the lazy `ChatRuntime`. */
export type ChatRuntimeProps = {
  readonly config: PublicChatConfig;
  /** True when the widget may be loaded: no consent required, or the shopper allowed the analytics category. */
  readonly allowed: boolean;
  /** Publishes the view and the open action to the call-outs; null takes the chat away. */
  readonly publish: (view: ChatView | null, open?: () => void) => void;
};

export type ChatCalloutProps = {
  /** Same classes as the neighbouring links. */
  readonly className: string;
  /** True in the header bar (a 16 px icon); false in the menu (20 px). */
  readonly dense?: boolean;
  /** Called before chat opens, for example to close the menu drawer. */
  readonly onActivate?: (() => void) | undefined;
};

/**
 * The props of the one lazy entry (ChatEntry). The header bar passes consent, which makes that instance also run the gate
 * (consent, idle, the runtime) for the provider named in the chat link; the mobile menu's instance shows the call-out only.
 */
export type ChatEntryProps = ChatCalloutProps & {
  /**
   * The header's utility links. The chat entry names the provider; the "contact" entry means the contact page exists (the
   * root loader's existence rule) and is where the notice sends a shopper whose chat failed.
   */
  readonly links: readonly UtilityLink[];
  readonly consent?: ChatConsent | undefined;
};
