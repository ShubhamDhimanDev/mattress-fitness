import {describe, expect, it} from 'vitest';
import {SIZES} from '~/lib/catalog/attributes';
import {mulberry32, randomSubset} from '~/lib/catalog/test-helpers';
import type {KeyValueStorage, SavedQuiz} from '~/lib/quiz/storage';
import {
  QUIZ_STORAGE_KEY,
  QUIZ_STORAGE_MAX_AGE_DAYS,
  QUIZ_STORAGE_MAX_BYTES,
  QUIZ_STORAGE_VERSION,
  checkStaleness,
  clearQuizFromDevice,
  loadQuizFromDevice,
  mergeOnSignIn,
  parseSavedQuiz,
  sanitizeSavedQuiz,
  saveQuizToDevice,
  savedQuizFromOutcome,
  serializeSavedQuiz,
} from '~/lib/quiz/storage';
import type {QuizOutcome} from '~/lib/quiz/types';

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
const DAY = 86_400_000;

const SAVED: SavedQuiz = {
  savedAt: NOW,
  configFingerprint: 'abc123',
  answers: {
    'sleep-position': ['side'],
    feel: ['soft'],
    discomfort: ['hips-shoulders', 'lower-back'],
  },
  results: [
    {
      handle: 'larkmoor-cedar-plush-hybrid',
      size: 'Queen',
      score: 15,
      reasons: ['Plush', 'Cooling', 'Side sleepers'],
    },
    {
      handle: 'tidewell-cove-ultra-plush-memory-foam',
      size: 'Queen',
      score: 15,
      reasons: ['Ultra Plush'],
    },
  ],
};

class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const throwingStorage: KeyValueStorage = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
  removeItem() {
    throw new Error('SecurityError');
  },
};

describe('saved quiz envelope (REQ-QZ-005)', () => {
  it('round-trips through serialize and parse', () => {
    const out = serializeSavedQuiz(SAVED);
    expect(out.status).toBe('ok');
    const json = out.status === 'ok' ? out.json : '';
    expect(JSON.parse(json)).toMatchObject({v: QUIZ_STORAGE_VERSION});
    expect(parseSavedQuiz(json)).toEqual({status: 'ok', saved: SAVED});
  });

  it('accepts an already parsed value, as read from an account metafield', () => {
    const out = serializeSavedQuiz(SAVED);
    const parsed: unknown = JSON.parse(out.status === 'ok' ? out.json : '');
    expect(parseSavedQuiz(parsed)).toEqual({status: 'ok', saved: SAVED});
  });

  it('never stores prices or variant IDs, which would come from the browser', () => {
    const out = serializeSavedQuiz({
      ...SAVED,
      results: SAVED.results.map((r) => ({
        ...r,
        priceCents: 1,
        variantId: 'gid://x',
      })),
    });
    const json = out.status === 'ok' ? out.json : '';
    expect(json).not.toMatch(/price|variant|gid:/i);
  });

  it.each([
    [null, 'empty'],
    [undefined, 'empty'],
    ['', 'empty'],
  ])('treats %j as nothing saved', (raw, status) => {
    expect(parseSavedQuiz(raw)).toEqual({status});
  });

  it.each([
    ['not json at all', '{{{', 'corrupt'],
    ['truncated json', '{"v":1,"savedAt":', 'corrupt'],
    ['a json array', '[]', 'bad_shape'],
    ['a json number', '42', 'bad_shape'],
    ['a json null', 'null', 'bad_shape'],
    [
      'an old version',
      JSON.stringify({v: 0, savedAt: 1, answers: {}, results: []}),
      'unsupported_version',
    ],
    [
      'a future version',
      JSON.stringify({v: 2, savedAt: 1, answers: {}, results: []}),
      'unsupported_version',
    ],
    [
      'no version',
      JSON.stringify({savedAt: 1, answers: {}, results: []}),
      'unsupported_version',
    ],
    [
      'a text version',
      JSON.stringify({v: '1', savedAt: 1, answers: {}, results: []}),
      'unsupported_version',
    ],
    [
      'a missing time',
      JSON.stringify({v: 1, answers: {}, results: []}),
      'bad_shape',
    ],
    [
      'a negative time',
      JSON.stringify({v: 1, savedAt: -5, answers: {}, results: []}),
      'bad_shape',
    ],
    [
      'a fractional time',
      JSON.stringify({v: 1, savedAt: 1.5, answers: {}, results: []}),
      'bad_shape',
    ],
    [
      'a text time',
      JSON.stringify({v: 1, savedAt: 'now', answers: {}, results: []}),
      'bad_shape',
    ],
    [
      'answers that are a list',
      JSON.stringify({v: 1, savedAt: 1, answers: [], results: []}),
      'bad_shape',
    ],
    [
      'answers missing',
      JSON.stringify({v: 1, savedAt: 1, results: []}),
      'bad_shape',
    ],
    [
      'text over the size limit',
      'x'.repeat(QUIZ_STORAGE_MAX_BYTES + 1),
      'too_large',
    ],
    [
      'multi-byte text over the byte limit',
      '€'.repeat(QUIZ_STORAGE_MAX_BYTES / 2),
      'too_large',
    ],
  ])('reports %s without throwing', (_name, raw, reason) => {
    expect(parseSavedQuiz(raw)).toEqual({status: 'invalid', reason});
  });

  it('serializing refuses data that does not fit, and data that is invalid', () => {
    // The field caps keep normal saves tiny; this is the worst case they allow.
    const widest: SavedQuiz = {
      savedAt: NOW,
      configFingerprint: null,
      answers: Object.fromEntries(
        Array.from({length: 12}, (_, q) => [
          `${String(q).padStart(2, '0')}${'k'.repeat(62)}`,
          Array.from({length: 8}, (_o, o) => `${o}${'v'.repeat(63)}`),
        ]),
      ),
      results: Array.from({length: 3}, (_, r) => ({
        handle: `${r}${'h'.repeat(254)}`,
        size: 'Queen',
        score: 1,
        reasons: Array.from({length: 6}, (_x, x) => `${x}${'r'.repeat(59)}`),
      })),
    };
    expect(serializeSavedQuiz(widest)).toEqual({
      status: 'error',
      reason: 'too_large',
    });
    expect(serializeSavedQuiz({...SAVED, savedAt: -1})).toEqual({
      status: 'error',
      reason: 'invalid',
    });
  });

  describe('hostile content is cleaned or dropped (threat T-07)', () => {
    it('keeps only well-formed answers and caps their number', () => {
      const clean = sanitizeSavedQuiz({
        savedAt: 1,
        answers: Object.fromEntries([
          ['ok', ['a', 'a', 'b']],
          ['<script>', ['a']],
          ['__proto__', ['a']],
          ['bad-values', ['<img>', 42, null, 'fine']],
          ['not-a-list', 'a'],
          ...Array.from({length: 30}, (_, i) => [`extra-${i}`, ['x']]),
        ]),
        results: [],
      });
      expect(clean?.answers.ok).toEqual(['a', 'b']);
      expect(clean?.answers['bad-values']).toEqual(['fine']);
      expect(Object.keys(clean?.answers ?? {})).toHaveLength(12);
      expect(Object.keys(clean?.answers ?? {})).not.toContain('<script>');
      expect(Object.keys(clean?.answers ?? {})).not.toContain('__proto__');
      expect(Object.keys(clean?.answers ?? {})).not.toContain('not-a-list');
    });

    it('drops results with a bad handle, size or score and cleans reasons', () => {
      const clean = sanitizeSavedQuiz({
        savedAt: 1,
        answers: {},
        results: [
          {
            handle: 'good',
            size: 'King',
            score: 3,
            reasons: ['<b>Cooling</b>', 'x'.repeat(200), 7, '\u0000'],
          },
          {handle: '../../etc/passwd', size: 'King', score: 3, reasons: []},
          {handle: 'UPPER', size: 'King', score: 3, reasons: []},
          {handle: 'bad-size', size: 'Emperor', score: 3, reasons: []},
          {handle: 'bad-score', size: 'King', score: 1.5, reasons: []},
          {handle: 'huge-score', size: 'King', score: 999999, reasons: []},
          {handle: 'text-score', size: 'King', score: '3', reasons: []},
          'text',
          null,
          {handle: 'fourth', size: 'Queen', score: 1, reasons: []},
          {handle: 'fifth', size: 'Queen', score: 1, reasons: []},
          {handle: 'sixth', size: 'Queen', score: 1, reasons: []},
        ],
      });
      expect(clean?.results.map((r) => r.handle)).toEqual([
        'good',
        'fourth',
        'fifth',
      ]);
      expect(clean?.results[0]?.reasons).toEqual(['Cooling']);
    });

    it('ignores a malformed fingerprint', () => {
      for (const configFingerprint of [
        '<script>',
        'XYZ',
        'a'.repeat(40),
        7,
        {},
      ]) {
        expect(
          sanitizeSavedQuiz({
            savedAt: 1,
            answers: {},
            results: [],
            configFingerprint,
          })?.configFingerprint,
        ).toBeNull();
      }
    });

    it('does not let a "__proto__" answer key pollute anything', () => {
      const parsed = parseSavedQuiz(
        '{"v":1,"savedAt":1,"answers":{"__proto__":["a"],"constructor":["b"]},"results":[]}',
      );
      const answers = parsed.status === 'ok' ? parsed.saved.answers : {};
      expect(Object.keys(answers)).toEqual(['constructor']);
      expect(Object.getPrototypeOf(answers)).toBe(Object.prototype);
      expect(Object.prototype).not.toHaveProperty('a');
    });
  });

  it('property: 300 random valid saves survive a round trip unchanged', () => {
    const random = mulberry32(8080);
    const words = [
      'side',
      'back',
      'soft',
      'firm',
      'lower-back',
      'queen',
      'up-to-1500',
      'x_1',
    ];
    for (let i = 0; i < 300; i += 1) {
      const questionIds = randomSubset(
        ['q1', 'q2', 'sleep-position', 'feel', 'size', 'budget'],
        6,
        random,
      );
      const saved: SavedQuiz = {
        savedAt: Math.floor(random() * 4e12),
        configFingerprint:
          random() < 0.5 ? null : Math.floor(random() * 1e9).toString(16),
        answers: Object.fromEntries(
          questionIds.map((id) => [id, randomSubset(words, 3, random)]),
        ),
        results: randomSubset(SIZES, 3, random).map((size, k) => ({
          handle: `product-${k}-${Math.floor(random() * 1000)}`,
          size,
          score: Math.floor(random() * 40) - 5,
          reasons: randomSubset(
            ['Medium', 'Hybrid', 'Cooling', 'Side sleepers'],
            4,
            random,
          ),
        })),
      };
      const out = serializeSavedQuiz(saved);
      expect(out.status).toBe('ok');
      expect(parseSavedQuiz(out.status === 'ok' ? out.json : '')).toEqual({
        status: 'ok',
        saved,
      });
    }
  });
});

describe('device storage adapters (REQ-QZ-005)', () => {
  it('saves, loads and clears through the injected storage', () => {
    const storage = new MemoryStorage();
    expect(loadQuizFromDevice(storage)).toEqual({status: 'empty'});
    expect(saveQuizToDevice(storage, SAVED)).toEqual({status: 'saved'});
    expect(storage.data.has(QUIZ_STORAGE_KEY)).toBe(true);
    expect(loadQuizFromDevice(storage)).toEqual({status: 'ok', saved: SAVED});
    expect(clearQuizFromDevice(storage)).toEqual({status: 'cleared'});
    expect(loadQuizFromDevice(storage)).toEqual({status: 'empty'});
  });

  it('removes a corrupted entry so it is not retried', () => {
    const storage = new MemoryStorage();
    storage.setItem(QUIZ_STORAGE_KEY, '{broken');
    expect(loadQuizFromDevice(storage)).toEqual({
      status: 'invalid',
      reason: 'corrupt',
    });
    expect(storage.data.has(QUIZ_STORAGE_KEY)).toBe(false);
  });

  it('removes an entry from an unsupported version too', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      QUIZ_STORAGE_KEY,
      JSON.stringify({v: 9, savedAt: 1, answers: {}, results: []}),
    );
    expect(loadQuizFromDevice(storage)).toEqual({
      status: 'invalid',
      reason: 'unsupported_version',
    });
    expect(storage.data.size).toBe(0);
  });

  it('reports unavailable storage instead of throwing', () => {
    expect(saveQuizToDevice(throwingStorage, SAVED)).toEqual({
      status: 'error',
      reason: 'storage_unavailable',
    });
    expect(loadQuizFromDevice(throwingStorage)).toEqual({
      status: 'storage_unavailable',
    });
    expect(clearQuizFromDevice(throwingStorage)).toEqual({
      status: 'storage_unavailable',
    });
  });

  it('refuses to write something invalid', () => {
    const storage = new MemoryStorage();
    expect(saveQuizToDevice(storage, {...SAVED, savedAt: Number.NaN})).toEqual({
      status: 'error',
      reason: 'invalid',
    });
    expect(storage.data.size).toBe(0);
  });

  it('does not touch other keys', () => {
    const storage = new MemoryStorage();
    storage.setItem('compare.v1', '["a"]');
    saveQuizToDevice(storage, SAVED);
    clearQuizFromDevice(storage);
    expect(storage.getItem('compare.v1')).toBe('["a"]');
  });
});

describe('signing in: device and account copies (REQ-QZ-005)', () => {
  const older: SavedQuiz = {...SAVED, savedAt: NOW - DAY};
  const newer: SavedQuiz = {...SAVED, savedAt: NOW + DAY};

  it.each<[string, SavedQuiz | null, SavedQuiz | null, string]>([
    ['nothing anywhere', null, null, 'none'],
    ['only on this device', SAVED, null, 'upload_device'],
    ['only in the account', null, SAVED, 'use_account'],
    ['device newer than account', newer, older, 'upload_device'],
    ['account newer than device', older, newer, 'use_account'],
    ['same time (the account is authoritative)', SAVED, SAVED, 'use_account'],
  ])('%s -> %s', (_name, device, account, action) => {
    expect(mergeOnSignIn(device, account).action).toBe(action);
  });

  it('returns the copy it chose', () => {
    expect(mergeOnSignIn(newer, older)).toEqual({
      action: 'upload_device',
      saved: newer,
    });
    expect(mergeOnSignIn(older, newer)).toEqual({
      action: 'use_account',
      saved: newer,
    });
  });
});

describe('staleness (REQ-QZ-005)', () => {
  it.each([
    ['just saved', 0, 'abc123', 'abc123', 'fresh'],
    ['a week old', 7 * DAY, 'abc123', 'abc123', 'fresh'],
    [
      'right at the limit',
      QUIZ_STORAGE_MAX_AGE_DAYS * DAY,
      'abc123',
      'abc123',
      'fresh',
    ],
    [
      'past the limit',
      QUIZ_STORAGE_MAX_AGE_DAYS * DAY + 1,
      'abc123',
      'abc123',
      'expired',
    ],
    ['the quiz was edited', DAY, 'abc123', 'def456', 'config_changed'],
    ['saved without a fingerprint', DAY, null, 'def456', 'fresh'],
    ['no current fingerprint to compare', DAY, 'abc123', null, 'fresh'],
  ] as const)('%s', (_name, age, saved, current, expected) => {
    expect(
      checkStaleness(
        {...SAVED, savedAt: NOW - age, configFingerprint: saved},
        NOW,
        current,
      ),
    ).toBe(expected);
  });
});

describe('building a save from a scoring outcome', () => {
  const ok: QuizOutcome = {
    status: 'ok',
    size: 'Queen',
    matches: [
      {
        rank: 1,
        productId: 'id1',
        handle: 'larkmoor-cedar-plush-hybrid',
        title: 'T',
        brand: 'B',
        score: 15,
        reasons: ['Plush', 'Cooling'],
        reasonLine: 'Plush · Cooling',
        size: 'Queen',
        variantId: 'gid://shopify/ProductVariant/1',
        priceCents: 159900,
        compareAtCents: null,
      },
    ],
  };

  it('keeps handle, size, score and reasons only', () => {
    const saved = savedQuizFromOutcome({
      answers: SAVED.answers,
      outcome: ok,
      nowMs: NOW,
      configFingerprint: 'abc123',
    });
    expect(saved?.results).toEqual([
      {
        handle: 'larkmoor-cedar-plush-hybrid',
        size: 'Queen',
        score: 15,
        reasons: ['Plush', 'Cooling'],
      },
    ]);
    expect(saved?.savedAt).toBe(NOW);
  });

  it('saves the answers alone when there were no matches', () => {
    const saved = savedQuizFromOutcome({
      answers: SAVED.answers,
      outcome: {status: 'empty', size: 'Queen', reason: 'nothing_in_budget'},
      nowMs: NOW,
      configFingerprint: null,
    });
    expect(saved?.results).toEqual([]);
    expect(saved?.answers).toEqual(SAVED.answers);
  });

  it('returns null rather than saving an unusable clock value', () => {
    expect(
      savedQuizFromOutcome({
        answers: {},
        outcome: ok,
        nowMs: -1,
        configFingerprint: null,
      }),
    ).toBeNull();
  });
});
