import {describe, expect, it} from 'vitest';
import {SIZES} from '~/lib/catalog/attributes';
import {SIZE_DIMENSIONS} from '~/lib/catalog/builders';
import {parseFilterParams} from '~/lib/filters';
import {buildFinder, finderHref} from '~/lib/shopify/home-finder';
import {plainHeading, splitHighlight} from '~/lib/shopify/home-highlight';
import {
  groupHomeSections,
  mapHomeSections,
  type SectionNode,
} from '~/lib/shopify/home-sections';
import {mapGeneralFaqs} from '~/lib/shopify/home-data';
import {BED_SHAPES, bedBoxStyle} from '~/lib/shopify/home-sizes';

// REQ-HOME-001 / CR-31: the redesigned home blocks (highlighted heading, finder, bed shapes, new block types, offers row).

const ON = {enabled: 'true'};

function node(
  id: string,
  fields: Record<string, string>,
  cards: Record<string, string>[] = [],
): SectionNode {
  return {
    id,
    fields: [
      ...Object.entries(fields).map(([key, value]) => ({
        key,
        value,
        reference: null,
      })),
      ...(cards.length > 0
        ? [
            {
              key: 'cards',
              value: '[]',
              references: {
                nodes: cards.map((card) => ({
                  fields: Object.entries(card).map(([key, value]) => ({
                    key,
                    value,
                    reference: null,
                  })),
                })),
              },
            },
          ]
        : []),
    ],
  };
}

describe('splitHighlight (REQ-HOME-001, T-07)', () => {
  it.each([
    [
      'Find the mattress that [[fits you.]]',
      [
        {text: 'Find the mattress that ', marked: false},
        {text: 'fits you.', marked: true},
      ],
    ],
    [
      'Take the [[sleep quiz]] today',
      [
        {text: 'Take the ', marked: false},
        {text: 'sleep quiz', marked: true},
        {text: ' today', marked: false},
      ],
    ],
    ['[[All of it]]', [{text: 'All of it', marked: true}]],
    ['No markers', [{text: 'No markers', marked: false}]],
  ])('splits %j', (input, expected) => {
    expect(splitHighlight(input)).toEqual(expected);
  });

  it.each([
    ['unclosed', 'Find [[the one', 'Find the one'],
    ['nested', 'a [[b [[c]] d]] e', 'a b c d e'],
    ['two phrases', '[[one]] and [[two]]', 'one and two'],
    ['empty marker', 'Hello [[]] world', 'Hello  world'],
    ['blank marker', 'Hello [[  ]] world', 'Hello    world'],
    ['single brackets are the admin text', 'Size [Queen]', 'Size [Queen]'],
  ])('ignores a malformed marker: %s', (_name, input, plain) => {
    const parts = splitHighlight(input);
    expect(parts.every((part) => !part.marked)).toBe(true);
    expect(parts.map((part) => part.text).join('')).toBe(plain);
  });

  it('never returns markup: tags stay literal text parts', () => {
    const parts = splitHighlight('<img src=x onerror=alert(1)> [[<b>x</b>]]');
    expect(parts.map((part) => part.text).join('')).toContain('<b>x</b>');
    expect(parts.some((part) => part.marked)).toBe(true);
  });

  it('gives an empty list for empty input and a plain heading without markers', () => {
    expect(splitHighlight('')).toEqual([]);
    expect(plainHeading('Find [[fits you.]]')).toBe('Find fits you.');
  });
});

describe('bed shapes', () => {
  it('uses the same dimensions as the catalog sizes', () => {
    for (const size of SIZES) {
      const shape = BED_SHAPES[size];
      expect(shape).toBeDefined();
      const catalog = SIZE_DIMENSIONS[size]
        .replaceAll('"', '')
        .replace(/ x /g, ' x ');
      if (size !== 'Split California King') {
        expect(`${shape.dimensions}`.replace(' in', '')).toBe(catalog);
      }
    }
  });

  it('draws the queen narrower and shorter than the king, in the real proportions', () => {
    expect(BED_SHAPES.Queen.widthInches).toBeLessThan(
      BED_SHAPES.King.widthInches,
    );
    expect(bedBoxStyle(BED_SHAPES.Queen).aspectRatio).toBe('60 / 80');
    expect(bedBoxStyle(BED_SHAPES['California King']).height).toBe('100%');
    expect(BED_SHAPES.Twin.pillows).toBe(1);
    expect(BED_SHAPES.Queen.pillows).toBe(2);
  });
});

describe('finder (REQ-HOME-001, REQ-COL-002)', () => {
  const finder = buildFinder(
    'mattresses',
    ['Twin', 'Queen'],
    ['Puffy', 'Sealy'],
  );

  it('builds options in the codec spelling and goes to the collection', () => {
    expect(finder?.action).toBe('/collections/mattresses');
    expect(finder?.size).toEqual({
      name: 'size',
      options: [
        {label: 'Twin', value: 'twin'},
        {label: 'Queen', value: 'queen'},
      ],
    });
    expect(finder?.comfort?.name).toBe('comfort');
    expect(finder?.comfort?.options.map((o) => o.value)).toContain(
      'ultra-plush',
    );
    expect(finder?.brand?.name).toBe('brand');
  });

  it('is left out without a size, and the brand select is left out without brands', () => {
    expect(buildFinder('x', [], ['Puffy'])).toBeNull();
    expect(buildFinder(null, ['Queen'], [])?.brand).toBeNull();
    expect(buildFinder(null, ['Queen'], [])?.action).toBe('/collections');
  });

  it('drops a brand name the codec would refuse instead of offering it', () => {
    expect(buildFinder(null, ['Queen'], ['<script>'])?.brand).toBeNull();
  });

  it('builds a link that parseFilterParams reads back to the same choices', () => {
    if (!finder) throw new Error('finder expected');
    const href = finderHref(finder, [
      ['size', 'queen'],
      ['comfort', 'plush'],
      ['brand', 'Puffy'],
    ]);
    const state = parseFilterParams(
      new URL(href, 'https://x.test').searchParams,
    );
    expect(state.selected.size).toEqual(['Queen']);
    expect(state.selected.comfortLevel).toEqual(['Plush']);
    expect(state.selected.brand).toEqual(['Puffy']);
  });

  it('keeps only known names and values, and drops empty and repeated ones', () => {
    if (!finder) throw new Error('finder expected');
    expect(
      finderHref(finder, [
        ['size', 'queen'],
        ['size', 'queen'],
        ['comfort', ''],
        ['brand', 'Not A Brand'],
        ['price_max', '1'],
        ['redirect', 'https://evil.test'],
        ['size', '<x>'],
      ]),
    ).toBe('/collections/mattresses?size=queen');
    expect(finderHref(finder, [])).toBe('/collections/mattresses');
  });
});

describe('new home block types (REQ-HOME-001, CR-31)', () => {
  it('reads the five content blocks with their cards, in admin order', () => {
    const sections = mapHomeSections([
      node('a', {...ON, type: 'faq', order: '5', heading: 'Questions'}),
      node(
        'b',
        {...ON, type: 'how-it-works', order: '3', heading: 'How it works'},
        [
          {title: 'One', text: 'First'},
          {title: 'Two', text: 'Second'},
        ],
      ),
      node('c', {
        ...ON,
        type: 'quiz-band',
        order: '1',
        heading: 'Take the [[quiz]]',
        link: '/quiz',
      }),
      node('d', {
        ...ON,
        type: 'store-finder',
        order: '4',
        heading: 'Find a store',
      }),
      node('e', {...ON, type: 'setup-cards', order: '2'}, [
        {title: 'Card', link: '/collections', link_label: 'Shop'},
      ]),
    ]);
    expect(sections.map((s) => (s.kind === 'block' ? s.type : s.kind))).toEqual(
      ['quiz-band', 'setup-cards', 'how-it-works', 'store-finder', 'faq'],
    );
    const quiz = sections[0];
    expect(quiz).toMatchObject({
      heading: 'Take the [[quiz]]',
      link: {href: '/quiz'},
    });
    const steps = sections[2];
    expect(steps.kind === 'block' && steps.cards.map((c) => c.title)).toEqual([
      'One',
      'Two',
    ]);
  });

  it('leaves out a block that is missing what it needs', () => {
    const sections = mapHomeSections([
      node('a', {...ON, type: 'quiz-band', order: '1'}),
      node('b', {...ON, type: 'store-finder', order: '2', heading: '  '}),
      node('c', {...ON, type: 'setup-cards', order: '3', heading: 'No cards'}),
      node('d', {...ON, type: 'how-it-works', order: '4'}, [
        {title: '   '},
        {text: 'no title'},
      ]),
    ]);
    expect(sections).toEqual([]);
  });

  it('keeps the highlight markers only where the block can show them', () => {
    const [hero, promo] = mapHomeSections([
      node('a', {...ON, type: 'hero', order: '1', heading: 'Fits [[you.]]'}),
      node('b', {
        ...ON,
        type: 'promo-banner',
        order: '2',
        heading: 'Big [[sale]]',
      }),
    ]);
    expect(hero).toMatchObject({heading: 'Fits [[you.]]'});
    expect(promo).toMatchObject({heading: 'Big sale'});
  });

  it('reads at most six cards, a card link only when it is an allowed one, and shows only one faq block', () => {
    const many = Array.from({length: 9}, (_, i) => ({title: `Card ${i}`}));
    const sections = mapHomeSections([
      node('a', {...ON, type: 'setup-cards', order: '1', heading: 'Cards'}, [
        ...many,
      ]),
      node('b', {...ON, type: 'faq', order: '2', heading: 'First'}),
      node('c', {...ON, type: 'faq', order: '3', heading: 'Second'}),
    ]);
    const cards = sections[0];
    expect(cards.kind === 'block' && cards.cards).toHaveLength(6);
    expect(
      sections.filter((s) => s.kind === 'block' && s.type === 'faq'),
    ).toHaveLength(1);

    const [hostile] = mapHomeSections([
      node('d', {...ON, type: 'setup-cards', order: '1'}, [
        {title: 'X', link: 'javascript:alert(1)'},
      ]),
    ]);
    expect(hostile.kind === 'block' && hostile.cards[0].link).toBeNull();
  });

  it('ignores a card entry of another type (an empty object)', () => {
    const base = node('a', {...ON, type: 'setup-cards', order: '1'});
    const empty: Record<string, never> = {};
    const section: SectionNode = {
      ...base,
      fields: [
        ...base.fields,
        {
          key: 'cards',
          value: '[]',
          references: {
            nodes: [empty, {fields: [{key: 'title', value: 'Real'}]}],
          },
        },
      ],
    };
    const [result] = mapHomeSections([section]);
    expect(result.kind === 'block' && result.cards.map((c) => c.title)).toEqual(
      ['Real'],
    );
  });
});

describe('groupHomeSections: consecutive promo banners are one row', () => {
  const promo = (id: string, order: string) =>
    node(id, {...ON, type: 'promo-banner', order, heading: id});

  it('groups up to three in a row and starts a new row for the fourth', () => {
    const groups = groupHomeSections(
      mapHomeSections([
        promo('a', '1'),
        promo('b', '2'),
        promo('c', '3'),
        promo('d', '4'),
      ]),
    );
    expect(
      groups.map((g) => (g.kind === 'offers' ? g.banners.length : 0)),
    ).toEqual([3, 1]);
  });

  it('keeps a lone banner as a group of one and splits runs separated by another section', () => {
    const groups = groupHomeSections(
      mapHomeSections([
        promo('a', '1'),
        node('x', {...ON, type: 'featured', order: '2'}),
        promo('b', '3'),
        promo('c', '4'),
      ]),
    );
    expect(
      groups.map((g) => (g.kind === 'offers' ? g.banners.length : 'section')),
    ).toEqual([1, 'section', 2]);
  });

  it('does not group the financing banner or the hero', () => {
    const groups = groupHomeSections(
      mapHomeSections([
        node('a', {...ON, type: 'hero', order: '1', heading: 'Hi'}),
        node('b', {...ON, type: 'financing', order: '2', heading: 'Pay later'}),
      ]),
    );
    expect(groups.every((g) => g.kind === 'section')).toBe(true);
  });
});

describe('general FAQ entries for the home faq block', () => {
  const faq = (id: string, scope: string | null, answer = 'Answer') => ({
    id,
    fields: [
      {key: 'question', value: `Question ${id}`},
      {
        key: 'answer',
        value: JSON.stringify({
          type: 'root',
          children: [
            {type: 'paragraph', children: [{type: 'text', value: answer}]},
          ],
        }),
      },
      {key: 'scope', value: scope},
    ],
  });

  it('keeps only scope general (case and spacing forgiven) and complete entries', () => {
    const faqs = mapGeneralFaqs([
      faq('1', 'general'),
      faq('2', ' General '),
      faq('3', 'product'),
      faq('4', null),
      faq('5', 'general', ''),
    ]);
    expect(faqs.map((f) => f.id)).toEqual(['1', '2']);
    expect(faqs[0].answer).toEqual(['Answer']);
  });

  it('is empty for no entries', () => {
    expect(mapGeneralFaqs(null)).toEqual([]);
    expect(mapGeneralFaqs([])).toEqual([]);
  });
});
