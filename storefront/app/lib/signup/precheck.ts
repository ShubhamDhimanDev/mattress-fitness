// The signup form's check before it is sent (REQ-ANL-003). Pure and small: it only saves the shopper a round trip.
// The server repeats every check with `parseSignupForm` and never relies on this one.

import {validateSignupEmail} from '~/lib/signup/email';
import {
  CONSENT_GIVEN,
  SIGNUP_FIELDS,
  SIGNUP_FIELD_ERRORS,
  type SignupFieldErrors,
} from '~/lib/signup/shared';

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function precheckSignup(
  form: FormData,
  options: {readonly sms: boolean},
): SignupFieldErrors {
  const errors: {
    -readonly [K in keyof SignupFieldErrors]: SignupFieldErrors[K];
  } = {};
  if (validateSignupEmail(field(form, SIGNUP_FIELDS.email)).status !== 'ok') {
    errors.email = SIGNUP_FIELD_ERRORS.email;
  }
  if (field(form, SIGNUP_FIELDS.emailConsent) !== CONSENT_GIVEN) {
    errors.consent = SIGNUP_FIELD_ERRORS.consent;
  }
  if (options.sms) {
    const phone = field(form, SIGNUP_FIELDS.phone);
    const ticked = field(form, SIGNUP_FIELDS.smsConsent) === CONSENT_GIVEN;
    if (ticked && phone === '') errors.phone = SIGNUP_FIELD_ERRORS.phoneNeeded;
    if (!ticked && phone !== '') {
      errors.smsConsent = SIGNUP_FIELD_ERRORS.smsConsent;
    }
  }
  return errors;
}
