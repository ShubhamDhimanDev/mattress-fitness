// Stable React keys for lists of plain strings that may repeat (paragraphs of Shopify text).

export type KeyedText = {readonly key: string; readonly text: string};

/**
 * Pairs each string with a key that stays unique when the same text appears twice: the text plus how many
 * identical strings came before it. Keys do not shift when an unrelated paragraph is inserted elsewhere.
 */
export function keyedText(items: readonly string[]): KeyedText[] {
  const seen = new Map<string, number>();
  return items.map((text) => {
    const count = seen.get(text) ?? 0;
    seen.set(text, count + 1);
    return {key: `${text}#${count}`, text};
  });
}
