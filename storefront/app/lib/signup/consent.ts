// The marketing consent sentences shown beside the signup checkboxes (REQ-ANL-003, NFR-011, T-16).
//
// Both the form (browser) and the server import this file, so the sentence a shopper read is the sentence the server
// knows. The form posts the VERSION it showed; the server refuses a version it does not recognise instead of recording
// consent for words the shopper never saw (a page cached across a deployment that changed the wording).
//
// Klaviyo has no field for the consent sentence itself (docs/integrations/KLAVIYO.md, "What Klaviyo records"): it
// records its own consent timestamp and the free-text `custom_source` we send. That text carries the surface and the
// version below, so a stored consent can be traced to the exact words through the version table in KLAVIYO.md and
// through git history. A test pins each sentence to a hash: changing the words without a new version fails.
//
// Wording status: EVERY sentence here is our draft. None has been approved by the client or its legal adviser
// (Q-015, Q-012, CLR-004). The SMS sentence is a PLACEHOLDER and cannot reach a production shopper until
// `clientApproved` is set true in a reviewed change (see `smsAvailable` in config.ts).

import {BRAND_NAME} from '~/lib/brand';

export type ConsentDefinition = {
  /** Changes whenever `text` changes. Sent with the form and written into Klaviyo's `custom_source`. */
  readonly version: string;
  readonly text: string;
  /** True only once the client (and its legal adviser, for SMS) approved exactly this text, in writing. */
  readonly clientApproved: boolean;
};

export const EMAIL_CONSENT: ConsentDefinition = {
  version: 'email-v1',
  text: `Yes, I would like to receive marketing emails from ${BRAND_NAME} about offers, new products and sleep advice. I can unsubscribe at any time.`,
  clientApproved: false,
};

/**
 * PLACEHOLDER pending client approval and legal review (Q-015, T-16). Do not edit this into final wording here
 * without a written approval: TCPA-style SMS consent needs the sender's name, the kind and frequency of messages, the
 * "not a condition of purchase" statement, message and data rates, and how to opt out, in the form counsel signs off.
 */
export const SMS_CONSENT: ConsentDefinition = {
  version: 'sms-placeholder-v0',
  text: `[PLACEHOLDER, wording not approved] I agree to receive recurring marketing text messages from ${BRAND_NAME} at the number above. Consent is not a condition of any purchase. Message and data rates may apply. Reply STOP to cancel.`,
  clientApproved: false,
};

/** Every sentence a form may show, by version: what the server accepts back. */
export const KNOWN_CONSENT_VERSIONS: ReadonlySet<string> = new Set([
  EMAIL_CONSENT.version,
  SMS_CONSENT.version,
]);
