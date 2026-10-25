// Shapes and texts shared by the signup form (browser) and the signup route (server) (REQ-ANL-003).
// Nothing here is secret and nothing here imports server code, so the lazy form chunk can use it.

/** Where on the site the form sits. Sent as a hidden field; the server accepts only these two (never free text). */
export const SIGNUP_SURFACES = ['footer', 'home'] as const;
export type SignupSurface = (typeof SIGNUP_SURFACES)[number];

export function isSignupSurface(value: unknown): value is SignupSurface {
  return SIGNUP_SURFACES.some((surface) => surface === value);
}

/** The form field names, in one place so the form, the parser and the tests cannot drift apart. */
export const SIGNUP_FIELDS = {
  email: 'email',
  emailConsent: 'consentEmail',
  emailConsentVersion: 'consentEmailVersion',
  phone: 'phone',
  smsConsent: 'consentSms',
  smsConsentVersion: 'consentSmsVersion',
  surface: 'surface',
  // A field no person sees. A bot that fills every input fills this one too (see request.ts).
  honeypot: 'company_website',
} as const;

/** The checkbox value that means "ticked". Anything else, including a missing field, means not consented. */
export const CONSENT_GIVEN = 'yes';

/** What the page may know about the signup: no key, no list id. Built on the server by `publicSignupConfig`. */
export type SignupPublicConfig = {
  /** The optional text-message fields are offered. */
  readonly sms: boolean;
  /** The privacy policy page, when it exists (the footer's list of legal links decides), else null. */
  readonly privacyHref: string | null;
};

export type SignupFieldErrors = {
  readonly email?: string;
  readonly consent?: string;
  readonly phone?: string;
  readonly smsConsent?: string;
  /** Not about one field: a tampered or out-of-date form. */
  readonly form?: string;
};

export type SignupResponse =
  | {readonly status: 'ok'; readonly message: string}
  | {
      readonly status: 'invalid';
      readonly message: string;
      readonly errors: SignupFieldErrors;
    }
  | {readonly status: 'rate_limited'; readonly message: string}
  | {readonly status: 'unavailable'; readonly message: string};

export const SIGNUP_MESSAGES = {
  // True whether the address was new, already on the list or waiting for a double opt-in confirmation (no enumeration).
  ok: 'Thank you. We have received your request. If we need you to confirm your email address, we will send you a message.',
  invalid: 'Please check the fields marked below and try again.',
  rateLimited: 'Too many attempts. Please wait a few minutes and try again.',
  unavailable:
    'Signup is not available right now. Please try again in a little while.',
} as const;

export const SIGNUP_FIELD_ERRORS = {
  email: 'Enter a valid email address, for example name@example.com.',
  consent: 'Tick the box to agree to receive marketing emails.',
  phone: 'Enter a US mobile number, for example (212) 555-0100.',
  phoneNeeded: 'Enter your mobile number to receive text messages.',
  smsConsent: 'Tick the box to agree to text messages, or clear the number.',
  stale: 'This form is out of date. Reload the page and try again.',
  // Klaviyo refused this one request. Which field is the cause is not known (its error text can quote the address).
  rejected:
    'We could not sign you up with those details. Check your email address and try again, or come back later.',
} as const;
