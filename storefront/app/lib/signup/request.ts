// SERVER ONLY. Turns the posted signup form into a typed, validated request (REQ-ANL-003, T-13, T-05).
// Pure: it reads a FormData and answers with a discriminated result; it does no I/O and logs nothing.
//
// Rules, each one tested:
//   - a filled honeypot field means a bot ONLY when the form was also submitted within two seconds of appearing, or never
//     said how long it was open (no JavaScript, or a script that skips the page). One stray autofill by a person who took
//     longer than that is ignored, not punished: the signup goes ahead and the caller logs it (review m4);
//   - the email must pass `validateSignupEmail`; the marketing-email consent must be the exact value "yes" (an unticked
//     box posts nothing) and must come with the version of the sentence the shopper saw;
//   - the SMS fields are looked at only when SMS is on. A number needs its own ticked consent and the other way round;
//   - a surface or a consent version this build does not know is a stale or tampered form, never "close enough".

import {normalizeUsPhone} from '~/lib/stores/directions';
import {EMAIL_CONSENT, SMS_CONSENT} from '~/lib/signup/consent';
import {validateSignupEmail} from '~/lib/signup/email';
import {
  CONSENT_GIVEN,
  isSignupSurface,
  SIGNUP_FIELDS,
  SIGNUP_FIELD_ERRORS,
  type SignupFieldErrors,
  type SignupSurface,
} from '~/lib/signup/shared';

export type SignupInput = {
  readonly email: string;
  readonly surface: SignupSurface;
  readonly emailConsentVersion: string;
  /** The honeypot held text but the form had been open long enough to be a person (autofill): the signup went ahead. */
  readonly strayFill: boolean;
  /** Present only when the shopper gave a valid number AND ticked the SMS consent. */
  readonly sms: {
    readonly phone: string;
    readonly consentVersion: string;
  } | null;
};

export type ParsedSignup =
  | {readonly status: 'ok'; readonly input: SignupInput}
  | {readonly status: 'honeypot'}
  | {readonly status: 'invalid'; readonly errors: SignupFieldErrors};

/** Under this many milliseconds on screen, a filled honeypot is a bot; a person cannot read and fill a form that fast. */
export const HONEYPOT_MIN_AGE_MS = 2000;

/** Whole milliseconds from the browser's own timer, or null when absent or not a plain number. */
function formAge(form: FormData): number | null {
  const raw = form.get(SIGNUP_FIELDS.formAge);
  return typeof raw === 'string' && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}

/** A plain string field, or null for anything else (missing, a file upload). */
function text(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === 'string' ? value : null;
}

export function parseSignupForm(
  form: FormData,
  options: {readonly sms: boolean},
): ParsedSignup {
  // A person cannot see the field, so content in it is a bot or an autofill. A file is never an autofill.
  const trap = form.get(SIGNUP_FIELDS.honeypot);
  const strayFill =
    trap !== null && !(typeof trap === 'string' && trap.trim() === '');
  if (strayFill) {
    const age = formAge(form);
    if (typeof trap !== 'string' || age === null || age < HONEYPOT_MIN_AGE_MS) {
      return {status: 'honeypot'};
    }
  }

  const surface = text(form, SIGNUP_FIELDS.surface);
  const emailVersion = text(form, SIGNUP_FIELDS.emailConsentVersion);
  if (!isSignupSurface(surface) || emailVersion !== EMAIL_CONSENT.version) {
    return {status: 'invalid', errors: {form: SIGNUP_FIELD_ERRORS.stale}};
  }

  const errors: {
    -readonly [K in keyof SignupFieldErrors]: SignupFieldErrors[K];
  } = {};
  const email = validateSignupEmail(text(form, SIGNUP_FIELDS.email));
  if (email.status !== 'ok') errors.email = SIGNUP_FIELD_ERRORS.email;
  if (text(form, SIGNUP_FIELDS.emailConsent) !== CONSENT_GIVEN) {
    errors.consent = SIGNUP_FIELD_ERRORS.consent;
  }

  let sms: SignupInput['sms'] = null;
  if (options.sms) {
    const phoneRaw = (text(form, SIGNUP_FIELDS.phone) ?? '').trim();
    const smsTicked = text(form, SIGNUP_FIELDS.smsConsent) === CONSENT_GIVEN;
    const smsVersion = text(form, SIGNUP_FIELDS.smsConsentVersion);
    if (smsTicked && smsVersion !== SMS_CONSENT.version) {
      return {status: 'invalid', errors: {form: SIGNUP_FIELD_ERRORS.stale}};
    }
    if (phoneRaw === '' && smsTicked) {
      errors.phone = SIGNUP_FIELD_ERRORS.phoneNeeded;
    } else if (phoneRaw !== '') {
      const phone = normalizeUsPhone(phoneRaw);
      if (phone === null) errors.phone = SIGNUP_FIELD_ERRORS.phone;
      else if (!smsTicked) errors.smsConsent = SIGNUP_FIELD_ERRORS.smsConsent;
      else sms = {phone: phone.e164, consentVersion: SMS_CONSENT.version};
    }
  }

  if (Object.keys(errors).length > 0 || email.status !== 'ok') {
    return {status: 'invalid', errors};
  }
  return {
    status: 'ok',
    input: {
      email: email.email,
      surface,
      emailConsentVersion: EMAIL_CONSENT.version,
      strayFill,
      sms,
    },
  };
}
