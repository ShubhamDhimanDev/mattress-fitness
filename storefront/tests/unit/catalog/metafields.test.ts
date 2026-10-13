import {describe, expect, it} from 'vitest';
import {BENEFITS, COMFORT_LEVELS} from '~/lib/catalog/attributes';
import {
  indexMetafields,
  readChoice,
  readChoices,
  readPositiveNumber,
  readSpecifications,
  readText,
  readTextList,
} from '~/lib/shopify/metafields';
import {richTextToParagraphs, textToParagraphs} from '~/lib/shopify/rich-text';

// Metafield values are untrusted admin text (T-07, T-15): bad data becomes "no data".
const values = (entries: Record<string, string>) =>
  indexMetafields(
    Object.entries(entries).map(([key, value]) => ({key, value})),
  );

describe('indexMetafields', () => {
  it('ignores null entries (missing metafields) and empty values', () => {
    const map = indexMetafields([
      null,
      {key: 'a', value: ' '},
      {key: 'b', value: 'x'},
      null,
    ]);
    expect([...map.keys()]).toEqual(['b']);
    expect(indexMetafields(null).size).toBe(0);
  });
});

describe('readChoice and readChoices', () => {
  it('canonicalises a single choice and rejects unknown ones', () => {
    expect(readChoice(values({c: 'ultra-plush'}), 'c', COMFORT_LEVELS)).toBe(
      'Ultra Plush',
    );
    expect(readChoice(values({c: 'Squishy'}), 'c', COMFORT_LEVELS)).toBeNull();
    expect(readChoice(values({}), 'c', COMFORT_LEVELS)).toBeNull();
  });

  it('reads JSON lists and comma lists, de-duplicates and orders by the standard list', () => {
    expect(
      readChoices(
        values({b: '["Back Support","cooling","Cooling","Nonsense",5]'}),
        'b',
        BENEFITS,
      ),
    ).toEqual(['Cooling', 'Back Support']);
    expect(
      readChoices(values({b: 'Cooling, Eco-Friendly'}), 'b', BENEFITS),
    ).toEqual(['Cooling', 'Eco-Friendly']);
    expect(readChoices(values({}), 'b', BENEFITS)).toEqual([]);
  });
});

describe('readText, readTextList, readPositiveNumber', () => {
  it('cleans text, strips tags and bounds length', () => {
    expect(readText(values({t: '  <b>Signature</b>\u0000 line '}), 't')).toBe(
      'Signature line',
    );
    expect(readText(values({t: 'x'.repeat(1000)}), 't')?.length).toBe(300);
    expect(readText(values({t: '<br>'}), 't')).toBeNull();
  });

  it('reads a JSON list of strings, skipping non-strings', () => {
    expect(readTextList(values({f: '["A",2,"<i>B</i>",""]'}), 'f')).toEqual([
      'A',
      'B',
    ]);
    expect(readTextList(values({f: 'not json\nsecond'}), 'f')).toEqual([
      'not json',
      'second',
    ]);
  });

  it('accepts only positive plain decimals', () => {
    expect(readPositiveNumber(values({h: '12'}), 'h')).toBe(12);
    expect(readPositiveNumber(values({h: '12.50'}), 'h')).toBe(12.5);
    for (const bad of ['0', '-3', 'abc', '1e3', '12 inches', '1,5', '12345']) {
      expect(readPositiveNumber(values({h: bad}), 'h')).toBeNull();
    }
  });
});

describe('readSpecifications', () => {
  it('reads label and value rows and plain objects', () => {
    expect(
      readSpecifications(
        values({
          s: '[{"label":"Layers","value":5},{"label":"Cover","value":"Knit"}]',
        }),
        's',
      ),
    ).toEqual([
      {label: 'Layers', value: '5'},
      {label: 'Cover', value: 'Knit'},
    ]);
    expect(readSpecifications(values({s: '{"Height":"12 in"}'}), 's')).toEqual([
      {label: 'Height', value: '12 in'},
    ]);
  });

  it('survives malformed JSON and hostile shapes', () => {
    expect(readSpecifications(values({s: '{broken'}), 's')).toEqual([]);
    expect(
      readSpecifications(
        values({s: '[1,null,{"label":{"a":1},"value":"x"}]'}),
        's',
      ),
    ).toEqual([]);
    expect(
      readSpecifications(
        values({
          s: `[${'{"label":"a","value":"b"},'.repeat(100)}{"label":"z","value":"z"}]`,
        }),
        's',
      ).length,
    ).toBe(30);
  });
});

describe('rich text', () => {
  it('turns Shopify rich text into paragraphs, one per block and list item', () => {
    const raw = JSON.stringify({
      type: 'root',
      children: [
        {
          type: 'heading',
          level: 2,
          children: [{type: 'text', value: 'Warranty'}],
        },
        {
          type: 'paragraph',
          children: [
            {type: 'text', value: '10 years, '},
            {type: 'text', value: 'limited.', bold: true},
          ],
        },
        {
          type: 'list',
          listType: 'unordered',
          children: [
            {type: 'list-item', children: [{type: 'text', value: 'Frame'}]},
            {type: 'list-item', children: [{type: 'text', value: 'Foam'}]},
          ],
        },
      ],
    });
    expect(richTextToParagraphs(raw)).toEqual([
      'Warranty',
      '10 years, limited.',
      'Frame',
      'Foam',
    ]);
  });

  it('treats non-JSON as plain text and never returns markup', () => {
    expect(richTextToParagraphs('Plain <script>x</script>text')).toEqual([
      'Plain xtext',
    ]);
    expect(richTextToParagraphs(null)).toEqual([]);
    expect(richTextToParagraphs('{"type":"root"}')).toEqual([]);
  });

  it('splits plain text on blank lines', () => {
    expect(textToParagraphs('One\nstill one\n\nTwo\r\n\r\nThree')).toEqual([
      'One still one',
      'Two',
      'Three',
    ]);
    expect(textToParagraphs('')).toEqual([]);
    expect(textToParagraphs(null)).toEqual([]);
  });
});
