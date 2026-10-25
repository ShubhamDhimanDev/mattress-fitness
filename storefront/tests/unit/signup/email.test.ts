import {describe, expect, it} from 'vitest';
import {limiterEmailKey, validateSignupEmail} from '~/lib/signup/email';

// REQ-ANL-003 / T-13 / T-05: the address check shared by the browser's pre-check and the server. Hostile and
// malformed values are the point: every one of them must be refused, never repaired.

describe('validateSignupEmail (REQ-ANL-003)', () => {
  it.each([
    ['name@example.com', 'name@example.com'],
    ['  Name.Last@Example.COM  ', 'name.last@example.com'],
    ['first+tag@mail.example.co.uk', 'first+tag@mail.example.co.uk'],
    ["o'brien@example.org", "o'brien@example.org"],
    ['a_b-c@sub-domain.example.com', 'a_b-c@sub-domain.example.com'],
    ['x@xn--bcher-kva.example', 'x@xn--bcher-kva.example'],
  ])('accepts %j as %j', (raw, expected) => {
    expect(validateSignupEmail(raw)).toEqual({status: 'ok', email: expected});
  });

  it.each([
    ['empty', ''],
    ['only spaces', '    '],
    ['no at sign', 'nobody.example.com'],
    ['two at signs', 'a@b@example.com'],
    ['nothing before the at sign', '@example.com'],
    ['no domain', 'name@'],
    ['no dot in the domain', 'name@localhost'],
    ['numeric top level (IP literal)', 'name@[127.0.0.1]'],
    ['dotted quad domain', 'name@127.0.0.1'],
    ['one-letter top level', 'name@example.c'],
    ['digits-only top level', 'name@example.123'],
    ['leading dot in local part', '.name@example.com'],
    ['trailing dot in local part', 'name.@example.com'],
    ['double dot in local part', 'na..me@example.com'],
    ['label starting with a hyphen', 'name@-example.com'],
    ['label ending with a hyphen', 'name@example-.com'],
    ['empty label', 'name@example..com'],
    ['trailing dot in domain', 'name@example.com.'],
    ['space inside', 'na me@example.com'],
    ['tab inside', 'na\tme@example.com'],
    ['comma list', 'a@example.com,b@example.com'],
    ['semicolon list', 'a@example.com;b@example.com'],
    ['angle brackets', 'Name <name@example.com>'],
    ['quoted local part', '"name"@example.com'],
    ['parenthesised comment', 'name(comment)@example.com'],
    ['raw Unicode local part', 'namé@example.com'],
    ['raw Unicode domain', 'name@bücher.example'],
    ['header break (CRLF)', 'name@example.com\r\nBcc: victim@example.com'],
    ['header break (LF)', 'name@example.com\nBcc: victim@example.com'],
    ['null byte', 'name\u0000@example.com'],
    ['zero-width space', 'na​me@example.com'],
    ['script tag', '<script>alert(1)</script>@example.com'],
    ['SQL-looking', "x' OR '1'='1@example.com"],
  ])('refuses %s', (_label, raw) => {
    expect(validateSignupEmail(raw)).toEqual({status: 'invalid'});
  });

  it('refuses values that are not strings', () => {
    for (const value of [
      null,
      undefined,
      42,
      {},
      [],
      ['a@example.com'],
      true,
    ]) {
      expect(validateSignupEmail(value)).toEqual({status: 'invalid'});
    }
  });

  it('enforces the length limits (254 address, 64 local part, 63 label)', () => {
    const domain = 'example.com';
    const local64 = 'a'.repeat(64);
    expect(validateSignupEmail(`${local64}@${domain}`).status).toBe('ok');
    expect(validateSignupEmail(`${local64}a@${domain}`).status).toBe('invalid');

    const label63 = 'b'.repeat(63);
    expect(validateSignupEmail(`x@${label63}.com`).status).toBe('ok');
    expect(validateSignupEmail(`x@${label63}b.com`).status).toBe('invalid');

    const long = `x@${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.${'f'.repeat(60)}.com`;
    expect(validateSignupEmail(long).status).toBe('ok');
    // Pushed past 254 characters in total, every label still legal: refused for length alone.
    expect(validateSignupEmail(`${'g'.repeat(40)}${long}`).status).toBe(
      'invalid',
    );
    expect(validateSignupEmail('a@b.c'.repeat(100)).status).toBe('invalid');
  });
});

describe('limiterEmailKey: one mailbox is one counter (T-13, the email-bombing guard)', () => {
  it.each([
    ['victim+1@example.com', 'victim@example.com'],
    ['victim+anything+else@example.com', 'victim@example.com'],
    ['victim@example.com', 'victim@example.com'],
    ['v.ictim+1@gmail.com', 'victim@gmail.com'],
    ['v.i.c.t.i.m@googlemail.com', 'victim@gmail.com'],
    // Yahoo "-keyword" extensions reach the base account (SU-L3).
    ['victim-shopping@yahoo.com', 'victim@yahoo.com'],
    ['victim-a-b+tag@ymail.com', 'victim@ymail.com'],
    ['victim-x@rocketmail.com', 'victim@rocketmail.com'],
    // A hyphen is an ordinary character everywhere else, and catch-all domains cannot be detected: not collapsed.
    ['first-last@example.com', 'first-last@example.com'],
    ['a1@catchall.example', 'a1@catchall.example'],
    ['-odd@yahoo.com', '-odd@yahoo.com'],
    // Dots are significant at other providers, so they are kept.
    ['v.ictim@example.com', 'v.ictim@example.com'],
  ])('%s is counted as %s', (email, key) => {
    expect(limiterEmailKey(email)).toBe(key);
  });

  it('keeps a leading plus (it is not a tag)', () => {
    expect(limiterEmailKey('+odd@example.com')).toBe('+odd@example.com');
  });
});
