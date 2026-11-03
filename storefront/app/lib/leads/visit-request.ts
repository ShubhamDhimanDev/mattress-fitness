// SERVER ONLY. Turns the posted "plan your visit" form into a typed request and the email the store team receives for it
// (CR-33, REQ-HOME-001, DEC-145). Pure: no I/O, no logging.
//
// The request is emailed over SMTP (lead-mailer.ts) to the addresses in the environment. Nothing is stored by the
// storefront or sent to Shopify.

import {
  BUDGET_OPTIONS,
  VISIT_WINDOW_OPTIONS,
  validateLeadForm,
  type LeadFormErrors,
  type LeadFormField,
} from '~/lib/leads/lead-form';
import {normalizeZip} from '~/lib/delivery/zip';
import {normalizeUsPhone} from '~/lib/phone';

/** A field no person sees: a bot that fills every input fills this one. */
export const VISIT_HONEYPOT_FIELD = 'website';

export const VISIT_MESSAGES = {
  ok: 'Thank you. We have your request and will call you to confirm your visit.',
  invalid: 'Please check the highlighted fields.',
  unavailable:
    'We could not send your request right now. Please try again later or call the store.',
  rateLimited: 'Too many requests. Please try again later.',
} as const;

export type VisitRequestResponse =
  | {readonly status: 'ok'; readonly message: string}
  | {
      readonly status: 'invalid';
      readonly message: string;
      readonly errors: LeadFormErrors;
    }
  | {readonly status: 'rate_limited' | 'unavailable'; readonly message: string};

export type VisitRequest = {
  readonly budget: string;
  readonly visitWindow: string;
  readonly firstName: string;
  readonly lastName: string | null;
  /** "+12125550100" */
  readonly phone: string;
  readonly zip: string;
};

export type ParsedVisitRequest =
  | {readonly status: 'ok'; readonly request: VisitRequest}
  | {readonly status: 'honeypot'}
  | {readonly status: 'invalid'; readonly errors: LeadFormErrors};

const FIELDS: readonly LeadFormField[] = [
  'budget',
  'visitWindow',
  'name',
  'phone',
  'zip',
];

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export function parseVisitForm(form: FormData): ParsedVisitRequest {
  if (text(form, VISIT_HONEYPOT_FIELD).trim() !== '') {
    return {status: 'honeypot'};
  }
  const values: Record<LeadFormField, string> = {
    budget: '',
    visitWindow: '',
    name: '',
    phone: '',
    zip: '',
  };
  for (const field of FIELDS) values[field] = text(form, field);

  const checked = validateLeadForm(values);
  const phone = normalizeUsPhone(values.phone.trim());
  if (!checked.ok || phone === null) {
    return {
      status: 'invalid',
      errors: checked.ok
        ? {phone: 'Enter a 10-digit US phone number.'}
        : checked.errors,
    };
  }
  const [first = '', ...rest] = values.name.trim().split(/\s+/);
  return {
    status: 'ok',
    request: {
      budget: values.budget,
      visitWindow: values.visitWindow,
      firstName: first,
      lastName: rest.length > 0 ? rest.join(' ') : null,
      phone: phone.e164,
      // validateLeadForm already proved the ZIP is valid.
      zip: normalizeZip(values.zip) ?? '',
    },
  };
}

function labelOf(
  options: readonly {readonly value: string; readonly label: string}[],
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/** "+12125550100" as "(212) 555-0100"; anything else unchanged. */
function displayPhone(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}

export const VISIT_EMAIL_SUBJECT = 'New visit request from the website';

/** The plain-text body of the email. Every value was validated or taken from an allow-list in parseVisitForm. */
export function visitEmailText(request: VisitRequest, date: Date): string {
  const name = [request.firstName, request.lastName]
    .filter((part): part is string => part !== null)
    .join(' ');
  return [
    'A visitor asked to plan a store visit.',
    '',
    `Name: ${name}`,
    `Phone: ${displayPhone(request.phone)}`,
    `ZIP: ${request.zip}`,
    `Budget: ${labelOf(BUDGET_OPTIONS, request.budget)}`,
    `Can visit: ${labelOf(VISIT_WINDOW_OPTIONS, request.visitWindow)}`,
    `Received: ${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    '',
  ].join('\n');
}
