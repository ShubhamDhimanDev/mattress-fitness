import {describe, expect, it} from 'vitest';
import {parseStepCommand} from '~/lib/delivery-runtime/step-command';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe('parseStepCommand (T-01: the browser names a step and an intent, nothing else)', () => {
  it('reads the comfort-guarantee intents', () => {
    expect(
      parseStepCommand(form({step: 'comfort-guarantee', intent: 'accept'})),
    ).toEqual({step: 'comfort-guarantee', intent: 'accept'});
    expect(
      parseStepCommand(form({step: 'comfort-guarantee', intent: 'decline'})),
    ).toEqual({step: 'comfort-guarantee', intent: 'decline'});
  });

  it('reads a delivery choice and refuses anything but the two documented values', () => {
    expect(
      parseStepCommand(
        form({step: 'delivery-choice', intent: 'choose', choice: 'pickup'}),
      ),
    ).toEqual({step: 'delivery-choice', intent: 'choose', choice: 'pickup'});
    for (const choice of ['', 'ship', 'IN-HOME ', '<script>', 'parcel']) {
      const parsed = parseStepCommand(
        form({step: 'delivery-choice', intent: 'choose', choice}),
      );
      // The attribute parser trims and lowercases, so only the exact documented values survive it.
      if (choice === 'IN-HOME ') {
        expect(parsed).toMatchObject({choice: 'in-home'});
      } else {
        expect(parsed).toBeNull();
      }
    }
  });

  it('reads pieces as digits only; anything else becomes NaN for the server to refuse', () => {
    const pieces = (value: string) =>
      parseStepCommand(
        form({step: 'haul-away', intent: 'accept', pieces: value}),
      );
    expect(pieces('2')).toEqual({
      step: 'haul-away',
      intent: 'accept',
      pieces: 2,
    });
    for (const bad of ['', '-1', '2.5', '1e3', '0x10', ' 3', 'two', '1234']) {
      expect(pieces(bad)).toMatchObject({pieces: Number.NaN});
    }
  });

  it('a missing pieces field is unreadable, not "all"', () => {
    expect(
      parseStepCommand(form({step: 'haul-away', intent: 'accept'})),
    ).toEqual({step: 'haul-away', intent: 'accept', pieces: Number.NaN});
  });

  it('declines haul-away without needing any other field', () => {
    expect(
      parseStepCommand(form({step: 'haul-away', intent: 'decline'})),
    ).toEqual({step: 'haul-away', intent: 'decline'});
  });

  it('refuses unknown steps, intents that belong to another step, and extra fields are ignored', () => {
    expect(parseStepCommand(form({step: 'evil', intent: 'accept'}))).toBeNull();
    expect(parseStepCommand(form({intent: 'accept'}))).toBeNull();
    expect(
      parseStepCommand(form({step: 'delivery-choice', intent: 'accept'})),
    ).toBeNull();
    expect(
      parseStepCommand(form({step: 'haul-away', intent: 'choose'})),
    ).toBeNull();
    const withExtras = parseStepCommand(
      form({
        step: 'haul-away',
        intent: 'decline',
        merchandiseId: 'gid://shopify/ProductVariant/1',
        quantity: '50',
      }),
    );
    expect(withExtras).toEqual({step: 'haul-away', intent: 'decline'});
  });
});
