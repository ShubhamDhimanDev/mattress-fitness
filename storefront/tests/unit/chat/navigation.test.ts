import {describe, expect, it} from 'vitest';
import {contactFallback} from '~/lib/chat/fallback';
import {buildUtilityLinks} from '~/lib/navigation';

// REQ-ANL-004 / REQ-CNT-001: the chat entry exists only when a provider is configured; its fallback is the contact page
// only when that page exists.

const ids = (links: ReturnType<typeof buildUtilityLinks>) =>
  links.map((link) => link.id);

describe('REQ-ANL-004 utility links and the chat entry', () => {
  it('has no chat entry by default, even with the contact page', () => {
    expect(ids(buildUtilityLinks(new Set(['/pages/contact'])))).toEqual([
      'track',
      'contact',
    ]);
  });

  it('adds the chat entry only when told a provider is configured', () => {
    expect(
      ids(buildUtilityLinks(new Set(['/pages/contact']), {chat: true})),
    ).toEqual(['track', 'contact', 'chat']);
    expect(ids(buildUtilityLinks(new Set(), {chat: true}))).toEqual([
      'track',
      'chat',
    ]);
  });

  it('carries the provider config on the chat entry, and not on the boolean form', () => {
    const config = {providerId: 'fake', requiresConsent: true} as const;
    const withConfig = buildUtilityLinks(new Set(), {chat: config}).find(
      (link) => link.id === 'chat',
    );
    expect(withConfig?.chat).toEqual(config);
    const boolean = buildUtilityLinks(new Set(), {chat: true}).find(
      (link) => link.id === 'chat',
    );
    expect(boolean).toBeDefined();
    expect(boolean?.chat).toBeUndefined();
    expect(ids(buildUtilityLinks(new Set(), {chat: false}))).toEqual(['track']);
  });

  it('contactFallback is the contact page when it exists and null otherwise', () => {
    expect(
      contactFallback(
        buildUtilityLinks(new Set(['/pages/contact']), {chat: true}),
      ),
    ).toBe('/pages/contact');
    expect(
      contactFallback(buildUtilityLinks(new Set(), {chat: true})),
    ).toBeNull();
  });
});
