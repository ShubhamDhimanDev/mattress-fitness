// The "plan your visit" lead form (CR-33): the answer lists and the validation, pure so they are unit-tested.
//
// Owner decision 2026-11-02: the form only fires the lead events (OpenAI `lead_created`, Meta `Lead`, GA4
// `generate_lead`); the answers are NOT stored or sent anywhere. Nothing here is logged or tracked as a parameter.

import {normalizeZip} from '~/lib/delivery/zip';

export const BUDGET_OPTIONS = [
  {value: 'under-1000', label: 'Under $1,000'},
  {value: '1000-1499', label: '$1,000–$1,499'},
  {value: '1500-2499', label: '$1,500–$2,499'},
  {value: '2500-plus', label: '$2,500+'},
] as const;

export const VISIT_WINDOW_OPTIONS = [
  {value: 'within-3-days', label: 'Within 3 days'},
  {value: 'within-7-days', label: 'Within 7 days'},
  {value: 'within-2-4-weeks', label: 'Within 2–4 weeks'},
  {value: 'just-exploring', label: 'Just exploring'},
] as const;

export type LeadFormField = 'budget' | 'visitWindow' | 'name' | 'phone' | 'zip';

export type LeadFormErrors = Partial<Record<LeadFormField, string>>;

export type LeadFormResult =
  | {readonly ok: true}
  | {readonly ok: false; readonly errors: LeadFormErrors};

const MAX_NAME_LENGTH = 80;
const US_PHONE_DIGITS = 10;

function isOneOf(
  options: readonly {readonly value: string}[],
  value: string,
): boolean {
  return options.some((option) => option.value === value);
}

/** Ten digits, or eleven starting with the US country code; separators and a leading "+" are ignored. */
export function isUsPhone(input: string): boolean {
  if (!/^[\d\s().+-]{1,25}$/.test(input)) return false;
  const digits = input.replace(/\D/g, '');
  if (digits.length === US_PHONE_DIGITS) return true;
  return digits.length === US_PHONE_DIGITS + 1 && digits.startsWith('1');
}

export function validateLeadForm(
  values: Readonly<Record<LeadFormField, string>>,
): LeadFormResult {
  const errors: LeadFormErrors = {};
  if (!isOneOf(BUDGET_OPTIONS, values.budget)) {
    errors.budget = 'Choose your budget.';
  }
  if (!isOneOf(VISIT_WINDOW_OPTIONS, values.visitWindow)) {
    errors.visitWindow = 'Choose when you can visit.';
  }
  const name = values.name.trim();
  if (name === '' || name.length > MAX_NAME_LENGTH) {
    errors.name = 'Enter your name.';
  }
  if (!isUsPhone(values.phone.trim())) {
    errors.phone = 'Enter a 10-digit US phone number.';
  }
  if (normalizeZip(values.zip) === null) {
    errors.zip = 'Enter a 5-digit ZIP code.';
  }
  return Object.keys(errors).length === 0 ? {ok: true} : {ok: false, errors};
}
