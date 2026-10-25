// SERVER ONLY. What the signup needs from the environment, and what the page may be told (REQ-ANL-003, P7-02).
//
// Names only here; values come from the request-context env (ADR-0004), never `process.env`.
//   KLAVIYO_PRIVATE_API_KEY      server only. A Klaviyo private key with the scopes the documented server endpoint
//                                names (lists:write, profiles:write, subscriptions:write). It never leaves the server.
//   KLAVIYO_LIST_ID              server only (a list id is not a secret, but nothing needs it in a browser).
//   PUBLIC_KLAVIYO_SMS_ENABLED   the exact text "true" turns the optional SMS fields on, and only if the SMS consent
//                                wording is client-approved (or in development). Anything else is off.
//   PUBLIC_KLAVIYO_COMPANY_ID    NOT read here. The documented browser endpoint takes it, but Klaviyo says that
//                                endpoint must not be called from a server (docs/integrations/KLAVIYO.md, section 2).
//
// With either server value missing or malformed the signup is OFF: the page is told `null`, so it renders no form, makes
// no request and loads no extra JavaScript.

import {readEnvString} from '~/lib/extend/env';
import {SMS_CONSENT} from '~/lib/signup/consent';
import type {SignupPublicConfig} from '~/lib/signup/shared';

export const KLAVIYO_ENV = {
  apiKey: 'KLAVIYO_PRIVATE_API_KEY',
  listId: 'KLAVIYO_LIST_ID',
  smsEnabled: 'PUBLIC_KLAVIYO_SMS_ENABLED',
} as const;

export type SignupServerConfig =
  | {
      readonly status: 'ready';
      readonly apiKey: string;
      readonly listId: string;
      /** The optional SMS fields are offered and accepted. */
      readonly sms: boolean;
    }
  | {
      readonly status: 'off';
      readonly reason: 'not_configured' | 'invalid_key' | 'invalid_list_id';
    };

export type SignupConfigOptions = {
  /**
   * True only in development (`import.meta.env.DEV`). A production build shows the SMS fields only when the SMS wording
   * has been approved; development may show the placeholder wording so the field can be built and reviewed.
   */
  readonly allowUnapprovedSms: boolean;
};

// Printable ASCII without spaces: safe in an HTTP header. The real key shape is not documented in what we verified, so
// nothing stricter is claimed.
const API_KEY = /^[\x21-\x7e]{8,200}$/;
// The documentation's example list id is six letters and digits; the allowed range is wider on purpose.
const LIST_ID = /^[A-Za-z0-9_-]{3,32}$/;

export function smsAvailable(
  env: object,
  options: SignupConfigOptions,
): boolean {
  // Exact match, like PUBLIC_CONSENT_MODE: "True", " true" or "1" mean off.
  const flag = Reflect.get(env, KLAVIYO_ENV.smsEnabled);
  if (flag !== 'true') return false;
  return SMS_CONSENT.clientApproved || options.allowUnapprovedSms;
}

export function readSignupConfig(
  env: object,
  options: SignupConfigOptions,
): SignupServerConfig {
  const apiKey = readEnvString(env, KLAVIYO_ENV.apiKey);
  const listId = readEnvString(env, KLAVIYO_ENV.listId);
  if (apiKey === null || listId === null) {
    return {status: 'off', reason: 'not_configured'};
  }
  if (!API_KEY.test(apiKey)) return {status: 'off', reason: 'invalid_key'};
  if (!LIST_ID.test(listId)) return {status: 'off', reason: 'invalid_list_id'};
  return {
    status: 'ready',
    apiKey,
    listId,
    sms: smsAvailable(env, options),
  };
}

/** `null` when the signup is off: the page then renders nothing at all. */
export function publicSignupConfig(
  env: object,
  privacyHref: string | null,
  options: SignupConfigOptions,
): SignupPublicConfig | null {
  const config = readSignupConfig(env, options);
  return config.status === 'ready' ? {sms: config.sms, privacyHref} : null;
}
