import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  parseChatConfig,
  parseChatRequiresConsent,
  resetChatConfigWarnings,
  resolvePublicChatConfig,
} from '~/lib/chat/config';

// REQ-ANL-004, NFR-011, NFR-013, Q-011: chat is off unless a runnable provider is named; the fake never runs outside
// development; Shopify Inbox is refused as blocked; consent is required unless the exact text `false` says otherwise.

const dev = {development: true, analyticsCategoryConfigured: true};

describe('REQ-ANL-004 parseChatConfig', () => {
  it.each([
    [{}, 'unset'],
    [{PUBLIC_CHAT_PROVIDER: ''}, 'unset'],
    [{PUBLIC_CHAT_PROVIDER: '   '}, 'unset'],
    [{PUBLIC_CHAT_PROVIDER: 'shopify-inbox'}, 'provider_blocked'],
    [{PUBLIC_CHAT_PROVIDER: 'tidio'}, 'provider_unknown'],
    [{PUBLIC_CHAT_PROVIDER: 'FAKE'}, 'provider_unknown'],
    [{PUBLIC_CHAT_PROVIDER: 'fake; script-src *'}, 'provider_unknown'],
    [{PUBLIC_CHAT_PROVIDER: '__proto__'}, 'provider_unknown'],
  ] as const)('refuses %j: %s', (env, reason) => {
    expect(parseChatConfig(env, dev)).toEqual({status: 'off', reason});
  });

  it('runs the fake provider in development only', () => {
    const env = {PUBLIC_CHAT_PROVIDER: 'fake'};
    expect(parseChatConfig(env, dev)).toEqual({
      status: 'on',
      config: {providerId: 'fake', requiresConsent: true},
    });
    expect(parseChatConfig(env, {...dev, development: false})).toEqual({
      status: 'off',
      reason: 'fake_outside_development',
    });
  });

  it('keeps a consent-gated chat off when the banner has no analytics category to offer', () => {
    expect(
      parseChatConfig(
        {PUBLIC_CHAT_PROVIDER: 'fake'},
        {...dev, analyticsCategoryConfigured: false},
      ),
    ).toEqual({status: 'off', reason: 'needs_consent_category'});
  });

  it('lets the exact text false drop the consent wait, with or without the category', () => {
    expect(
      parseChatConfig(
        {PUBLIC_CHAT_PROVIDER: 'fake', PUBLIC_CHAT_REQUIRES_CONSENT: 'false'},
        {...dev, analyticsCategoryConfigured: false},
      ),
    ).toEqual({
      status: 'on',
      config: {providerId: 'fake', requiresConsent: false},
    });
  });
});

describe('NFR-011 parseChatRequiresConsent is strict', () => {
  it.each([
    [undefined, true],
    ['', true],
    ['true', true],
    ['False', true],
    ['FALSE', true],
    [' false', true],
    ['0', true],
    ['no', true],
    ['false', false],
  ] as const)('%j gives %s', (value, expected) => {
    expect(parseChatRequiresConsent(value)).toBe(expected);
  });
});

describe('resolvePublicChatConfig', () => {
  beforeEach(() => resetChatConfigWarnings());

  it('says nothing when chat is simply not configured', () => {
    const warn = vi.fn();
    expect(resolvePublicChatConfig({}, dev, warn)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs a refusal once per reason, with the reason word only (never the value)', () => {
    const warn = vi.fn();
    const env = {PUBLIC_CHAT_PROVIDER: 'shopify-inbox'};
    expect(resolvePublicChatConfig(env, dev, warn)).toBeNull();
    expect(resolvePublicChatConfig(env, dev, warn)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('chat.config_refused', {
      reason: 'provider_blocked',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('shopify-inbox');
  });

  it('returns the public config, which carries no key', () => {
    const config = resolvePublicChatConfig(
      {PUBLIC_CHAT_PROVIDER: 'fake'},
      dev,
      vi.fn(),
    );
    expect(config).toEqual({providerId: 'fake', requiresConsent: true});
  });
});
