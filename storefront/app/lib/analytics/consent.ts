// What every provider is allowed to do: everything (owner decision 2026-11-14, DEC-REPLACE).
//
// The cookie banner, the stored decision, the opt-in / opt-out mode (`PUBLIC_CONSENT_MODE`) and the Global Privacy
// Control check were removed on the owner's instruction: tracking is always on for every configured provider.
// The two categories remain only because the providers, the runtime and the chat and Affirm gates are written
// against them; they now always read as allowed.

export type ConsentChoice = {
  readonly analytics: boolean;
  readonly marketing: boolean;
};

export const ALLOW_ALL: ConsentChoice = {analytics: true, marketing: true};
