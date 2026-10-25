import {describe, expect, it} from 'vitest';
import {EMAIL_CONSENT, SMS_CONSENT} from '~/lib/signup/consent';
import {precheckSignup} from '~/lib/signup/precheck';
import {parseSignupForm} from '~/lib/signup/request';
import {SIGNUP_FIELD_ERRORS, SIGNUP_FIELDS} from '~/lib/signup/shared';

// REQ-ANL-003 / NFR-011 / T-13: the posted form becomes a typed request or a refusal. Hostile values are refused,
// consent is never assumed, and a form built for different wording is never accepted.

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const VALID = {
  [SIGNUP_FIELDS.email]: 'Shopper@Example.com',
  [SIGNUP_FIELDS.emailConsent]: 'yes',
  [SIGNUP_FIELDS.emailConsentVersion]: EMAIL_CONSENT.version,
  [SIGNUP_FIELDS.surface]: 'footer',
};

describe('parseSignupForm: the email signup (REQ-ANL-003)', () => {
  it('accepts a ticked consent with the current wording version and lower-cases the address', () => {
    expect(parseSignupForm(form(VALID), {sms: false})).toEqual({
      status: 'ok',
      input: {
        email: 'shopper@example.com',
        surface: 'footer',
        emailConsentVersion: 'email-v1',
        sms: null,
      },
    });
  });

  it('accepts the home surface', () => {
    const parsed = parseSignupForm(
      form({...VALID, [SIGNUP_FIELDS.surface]: 'home'}),
      {sms: false},
    );
    expect(parsed).toMatchObject({status: 'ok', input: {surface: 'home'}});
  });

  it('NEVER assumes consent: a missing, empty or differently-valued checkbox is refused', () => {
    const {[SIGNUP_FIELDS.emailConsent]: _omitted, ...withoutConsent} = VALID;
    const cases: Record<string, string>[] = [
      withoutConsent,
      {...VALID, [SIGNUP_FIELDS.emailConsent]: ''},
      {...VALID, [SIGNUP_FIELDS.emailConsent]: 'on'},
      {...VALID, [SIGNUP_FIELDS.emailConsent]: 'true'},
      {...VALID, [SIGNUP_FIELDS.emailConsent]: 'YES'},
      {...VALID, [SIGNUP_FIELDS.emailConsent]: '1'},
    ];
    for (const fields of cases) {
      expect(parseSignupForm(form(fields), {sms: false})).toEqual({
        status: 'invalid',
        errors: {consent: SIGNUP_FIELD_ERRORS.consent},
      });
    }
  });

  it('reports both problems at once, so the shopper fixes the form in one go', () => {
    expect(
      parseSignupForm(
        form({
          ...VALID,
          [SIGNUP_FIELDS.email]: 'not an email',
          [SIGNUP_FIELDS.emailConsent]: '',
        }),
        {sms: false},
      ),
    ).toEqual({
      status: 'invalid',
      errors: {
        email: SIGNUP_FIELD_ERRORS.email,
        consent: SIGNUP_FIELD_ERRORS.consent,
      },
    });
  });

  it.each([
    ['a missing address', undefined],
    ['an empty address', ''],
    ['an address with a header break', 'a@example.com\r\nBcc: x@example.com'],
    ['two addresses', 'a@example.com, b@example.com'],
    ['a script', '<script>alert(1)</script>'],
    ['a very long value', `${'a'.repeat(5000)}@example.com`],
  ])('refuses %s', (_label, email) => {
    const fields: Record<string, string> = {...VALID};
    if (email === undefined) delete fields[SIGNUP_FIELDS.email];
    else fields[SIGNUP_FIELDS.email] = email;
    expect(parseSignupForm(form(fields), {sms: false})).toEqual({
      status: 'invalid',
      errors: {email: SIGNUP_FIELD_ERRORS.email},
    });
  });

  it('refuses an email field that is a file upload', () => {
    const parsed = parseSignupForm(
      form({
        ...VALID,
        [SIGNUP_FIELDS.email]: new File(['a@example.com'], 'a.txt'),
      }),
      {sms: false},
    );
    expect(parsed).toMatchObject({status: 'invalid'});
  });

  it('uses the first value when a field is sent twice, so a second address cannot ride along', () => {
    const data = form(VALID);
    data.append(SIGNUP_FIELDS.email, 'second@example.com');
    expect(parseSignupForm(data, {sms: false})).toMatchObject({
      status: 'ok',
      input: {email: 'shopper@example.com'},
    });
  });
});

describe('parseSignupForm: honeypot, stale and tampered forms', () => {
  it.each(['http://spam.example', 'x', '0', 'a@example.com'])(
    'a filled honeypot (%j) is a bot, even with an otherwise perfect form',
    (value) => {
      expect(
        parseSignupForm(form({...VALID, [SIGNUP_FIELDS.honeypot]: value}), {
          sms: false,
        }),
      ).toEqual({status: 'honeypot'});
    },
  );

  it('a honeypot holding only spaces counts as empty (some autofill adds whitespace)', () => {
    expect(
      parseSignupForm(form({...VALID, [SIGNUP_FIELDS.honeypot]: '   '}), {
        sms: false,
      }).status,
    ).toBe('ok');
  });

  it('a file in the honeypot is a bot', () => {
    expect(
      parseSignupForm(
        form({...VALID, [SIGNUP_FIELDS.honeypot]: new File(['x'], 'x.txt')}),
        {sms: false},
      ),
    ).toEqual({status: 'honeypot'});
  });

  it.each([
    ['an unknown surface', {[SIGNUP_FIELDS.surface]: 'popup'}],
    ['a surface with markup', {[SIGNUP_FIELDS.surface]: '<b>footer</b>'}],
    ['a missing surface', {[SIGNUP_FIELDS.surface]: ''}],
    [
      'an old consent version',
      {[SIGNUP_FIELDS.emailConsentVersion]: 'email-v0'},
    ],
    ['a missing consent version', {[SIGNUP_FIELDS.emailConsentVersion]: ''}],
    [
      'an invented consent version',
      {[SIGNUP_FIELDS.emailConsentVersion]: 'email-v1; DROP'},
    ],
  ])(
    'refuses a form with %s as out of date, recording nothing',
    (_label, patch) => {
      expect(parseSignupForm(form({...VALID, ...patch}), {sms: false})).toEqual(
        {
          status: 'invalid',
          errors: {form: SIGNUP_FIELD_ERRORS.stale},
        },
      );
    },
  );
});

describe('parseSignupForm: the optional text-message fields (T-16)', () => {
  const SMS_OK = {
    [SIGNUP_FIELDS.phone]: '(212) 555-0100',
    [SIGNUP_FIELDS.smsConsent]: 'yes',
    [SIGNUP_FIELDS.smsConsentVersion]: SMS_CONSENT.version,
  };

  it('accepts a number WITH its own ticked consent, as E.164', () => {
    expect(
      parseSignupForm(form({...VALID, ...SMS_OK}), {sms: true}),
    ).toMatchObject({
      status: 'ok',
      input: {
        sms: {phone: '+12125550100', consentVersion: SMS_CONSENT.version},
      },
    });
  });

  it('IGNORES the text-message fields completely when SMS is off', () => {
    const parsed = parseSignupForm(form({...VALID, ...SMS_OK}), {sms: false});
    expect(parsed).toMatchObject({status: 'ok', input: {sms: null}});
  });

  it('email consent never counts as text-message consent, and the reverse', () => {
    const {[SIGNUP_FIELDS.smsConsent]: _omitted, ...phoneOnly} = SMS_OK;
    expect(
      parseSignupForm(form({...VALID, ...phoneOnly}), {sms: true}),
    ).toEqual({
      status: 'invalid',
      errors: {smsConsent: SIGNUP_FIELD_ERRORS.smsConsent},
    });
    expect(
      parseSignupForm(
        form({
          ...VALID,
          [SIGNUP_FIELDS.smsConsent]: 'yes',
          [SIGNUP_FIELDS.smsConsentVersion]: SMS_CONSENT.version,
        }),
        {sms: true},
      ),
    ).toEqual({
      status: 'invalid',
      errors: {phone: SIGNUP_FIELD_ERRORS.phoneNeeded},
    });
  });

  it('no number and no SMS consent is simply an email-only signup', () => {
    expect(parseSignupForm(form(VALID), {sms: true})).toMatchObject({
      status: 'ok',
      input: {sms: null},
    });
  });

  it.each([
    'abc',
    '123',
    '+44 20 7946 0958',
    '212-555-0100 ext 5',
    '(012) 345-6789',
    '1'.repeat(40),
  ])('refuses the number %j', (phone) => {
    expect(
      parseSignupForm(
        form({...VALID, ...SMS_OK, [SIGNUP_FIELDS.phone]: phone}),
        {sms: true},
      ),
    ).toEqual({status: 'invalid', errors: {phone: SIGNUP_FIELD_ERRORS.phone}});
  });

  it('refuses a ticked SMS consent that names wording this build does not have', () => {
    expect(
      parseSignupForm(
        form({
          ...VALID,
          ...SMS_OK,
          [SIGNUP_FIELDS.smsConsentVersion]: 'sms-v9',
        }),
        {sms: true},
      ),
    ).toEqual({status: 'invalid', errors: {form: SIGNUP_FIELD_ERRORS.stale}});
  });
});

describe('precheckSignup: the browser pre-check mirrors the server rules', () => {
  it('passes a good form and flags the same fields the server would', () => {
    expect(precheckSignup(form(VALID), {sms: false})).toEqual({});
    expect(
      precheckSignup(
        form({
          ...VALID,
          [SIGNUP_FIELDS.email]: 'x',
          [SIGNUP_FIELDS.emailConsent]: '',
        }),
        {sms: false},
      ),
    ).toEqual({
      email: SIGNUP_FIELD_ERRORS.email,
      consent: SIGNUP_FIELD_ERRORS.consent,
    });
  });

  it('pairs a number with its consent when SMS is on, and ignores both when it is off', () => {
    const phoneOnly = form({...VALID, [SIGNUP_FIELDS.phone]: '2125550100'});
    expect(precheckSignup(phoneOnly, {sms: true})).toEqual({
      smsConsent: SIGNUP_FIELD_ERRORS.smsConsent,
    });
    expect(precheckSignup(phoneOnly, {sms: false})).toEqual({});
    expect(
      precheckSignup(form({...VALID, [SIGNUP_FIELDS.smsConsent]: 'yes'}), {
        sms: true,
      }),
    ).toEqual({phone: SIGNUP_FIELD_ERRORS.phoneNeeded});
  });
});
