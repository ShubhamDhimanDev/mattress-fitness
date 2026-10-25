import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {
  KLAVIYO_ENV,
  publicSignupConfig,
  readSignupConfig,
  smsAvailable,
} from '~/lib/signup/config';
import {
  EMAIL_CONSENT,
  KNOWN_CONSENT_VERSIONS,
  SMS_CONSENT,
} from '~/lib/signup/consent';

// REQ-ANL-003 / NFR-011 / T-16: the consent sentences are pinned (changing the words forces a new version), the SMS
// wording stays unapproved and cannot reach production, and the signup is OFF unless both server values are usable.

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

describe('consent sentences are pinned to their version (T-16)', () => {
  it('the email sentence is exactly the pinned text for its version', () => {
    expect(EMAIL_CONSENT.version).toBe('email-v1');
    expect(sha256(EMAIL_CONSENT.text)).toBe(
      '23a6bfc643f23392cfd00d3cd402a3d59040b4d62fb70015fa26b506dfd81882',
    );
  });

  it('the SMS sentence is the pinned PLACEHOLDER and is marked as such', () => {
    expect(SMS_CONSENT.version).toBe('sms-placeholder-v0');
    expect(sha256(SMS_CONSENT.text)).toBe(
      'aba08129cf2062c17653b46bfedc5adf1072f6db7d652928203a617fd64043a6',
    );
    expect(SMS_CONSENT.text).toMatch(/PLACEHOLDER/);
  });

  it('no sentence is client-approved yet (Q-015, Q-012): approval is a reviewed code change', () => {
    expect(EMAIL_CONSENT.clientApproved).toBe(false);
    expect(SMS_CONSENT.clientApproved).toBe(false);
  });

  it('the server recognises exactly the versions the form can send', () => {
    expect([...KNOWN_CONSENT_VERSIONS].sort()).toEqual(
      [EMAIL_CONSENT.version, SMS_CONSENT.version].sort(),
    );
  });

  it('the email sentence says what the shopper agrees to and that they can leave', () => {
    expect(EMAIL_CONSENT.text).toMatch(/marketing emails/);
    expect(EMAIL_CONSENT.text).toMatch(/unsubscribe at any time/);
  });
});

const GOOD = {
  [KLAVIYO_ENV.apiKey]: 'fixture-private-key-not-real-0000',
  [KLAVIYO_ENV.listId]: 'AbC123',
};
const PRODUCTION = {allowUnapprovedSms: false};
const DEVELOPMENT = {allowUnapprovedSms: true};

describe('readSignupConfig: off unless both server values are usable (fail closed)', () => {
  it('is ready with a key and a list id, SMS off by default', () => {
    expect(readSignupConfig(GOOD, PRODUCTION)).toEqual({
      status: 'ready',
      apiKey: GOOD[KLAVIYO_ENV.apiKey],
      listId: 'AbC123',
      sms: false,
    });
  });

  it.each([
    ['nothing set', {}],
    ['only the key', {[KLAVIYO_ENV.apiKey]: GOOD[KLAVIYO_ENV.apiKey]}],
    ['only the list', {[KLAVIYO_ENV.listId]: 'AbC123'}],
    ['blank values', {[KLAVIYO_ENV.apiKey]: '  ', [KLAVIYO_ENV.listId]: ''}],
    [
      'values that are not strings',
      {[KLAVIYO_ENV.apiKey]: 1, [KLAVIYO_ENV.listId]: {}},
    ],
  ])('is off when %s', (_label, env) => {
    expect(readSignupConfig(env, PRODUCTION)).toEqual({
      status: 'off',
      reason: 'not_configured',
    });
    expect(publicSignupConfig(env, null, PRODUCTION)).toBeNull();
  });

  it.each([
    ['a space inside the key', 'bad key value 1234'],
    ['a header break in the key', 'abcdefgh\r\nX-Evil: 1'],
    ['a key that is too short', 'short'],
    ['a key with a non-ASCII character', 'abcdefghé12345'],
  ])('refuses %s (it goes into an HTTP header)', (_label, key) => {
    const env = {...GOOD, [KLAVIYO_ENV.apiKey]: key};
    expect(readSignupConfig(env, PRODUCTION)).toEqual({
      status: 'off',
      reason: 'invalid_key',
    });
  });

  it.each(['ab', 'has space', 'semi;colon', 'x'.repeat(33), '../etc'])(
    'refuses the list id %j',
    (listId) => {
      const env = {...GOOD, [KLAVIYO_ENV.listId]: listId};
      expect(readSignupConfig(env, PRODUCTION)).toEqual({
        status: 'off',
        reason: 'invalid_list_id',
      });
    },
  );

  it('the page is told only whether to render and the privacy link: never the key or the list id', () => {
    const config = publicSignupConfig(
      {...GOOD, [KLAVIYO_ENV.smsEnabled]: 'true'},
      '/policies/privacy-policy',
      DEVELOPMENT,
    );
    expect(config).toEqual({
      sms: true,
      privacyHref: '/policies/privacy-policy',
    });
    const text = JSON.stringify(config);
    expect(text).not.toContain(GOOD[KLAVIYO_ENV.apiKey]);
    expect(text).not.toContain('AbC123');
  });

  it('does not read PUBLIC_KLAVIYO_COMPANY_ID: it is not needed and not a way to switch the form on', () => {
    expect(
      readSignupConfig({PUBLIC_KLAVIYO_COMPANY_ID: 'AbC123'}, PRODUCTION),
    ).toEqual({status: 'off', reason: 'not_configured'});
  });
});

describe('SMS is off by default and cannot reach production with the placeholder wording (T-16, Q-015)', () => {
  it.each([
    undefined,
    '',
    'false',
    'True',
    'TRUE',
    ' true',
    'true ',
    '1',
    'yes',
    'on',
  ])('flag %j keeps SMS off, even in development', (flag) => {
    const env = flag === undefined ? {} : {[KLAVIYO_ENV.smsEnabled]: flag};
    expect(smsAvailable(env, DEVELOPMENT)).toBe(false);
    expect(smsAvailable(env, PRODUCTION)).toBe(false);
  });

  it('the exact flag "true" shows the placeholder in development only', () => {
    const env = {[KLAVIYO_ENV.smsEnabled]: 'true'};
    expect(smsAvailable(env, DEVELOPMENT)).toBe(true);
    // A production build with unapproved wording stays off: the flag alone is not enough.
    expect(smsAvailable(env, PRODUCTION)).toBe(false);
    expect(readSignupConfig({...GOOD, ...env}, PRODUCTION)).toMatchObject({
      status: 'ready',
      sms: false,
    });
    expect(readSignupConfig({...GOOD, ...env}, DEVELOPMENT)).toMatchObject({
      status: 'ready',
      sms: true,
    });
  });
});
