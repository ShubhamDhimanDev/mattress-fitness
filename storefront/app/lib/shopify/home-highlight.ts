// The highlighted phrase of a home heading (CR-31). Admin marks it with double square brackets, for example
// `Find the mattress that [[fits you.]]`. The result is plain-text parts, never HTML: the component renders each part as
// a React text node (marked ones inside a span), so nothing the admin types can become markup (T-07).

export type HeadingPart = {
  readonly text: string;
  readonly marked: boolean;
};

// One marked phrase only: no other square bracket anywhere in the heading, so a nested marker (`[[a [[b]] c]]`), a second
// phrase and a stray bracket all fall through to the plain reading below.
const ONE_MARKED_PHRASE = /^([^[\]]*)\[\[([^[\]]+)\]\]([^[\]]*)$/;

/** Removes marker tokens only; a single bracket in the text is the admin's own and stays. */
function withoutMarkers(text: string): string {
  return text.replaceAll('[[', '').replaceAll(']]', '');
}

/**
 * Splits a heading into the parts to render. A heading with exactly one well-formed `[[phrase]]` gives up to three parts
 * (before, marked, after). Anything else (unclosed, nested, empty, more than one phrase) is ignored: the markers are
 * dropped and the text is returned as one unmarked part, so a shopper never sees stray brackets.
 */
export function splitHighlight(text: string): HeadingPart[] {
  const match = ONE_MARKED_PHRASE.exec(text);
  if (match !== null && match[2].trim() !== '') {
    const parts: HeadingPart[] = [
      {text: match[1], marked: false},
      {text: match[2], marked: true},
      {text: match[3], marked: false},
    ];
    return parts.filter((part) => part.text !== '');
  }
  const plain = withoutMarkers(text);
  return plain === '' ? [] : [{text: plain, marked: false}];
}

/** The heading as plain text, for places that cannot show a highlight (a document title, an accessible name). */
export function plainHeading(text: string): string {
  return splitHighlight(text)
    .map((part) => part.text)
    .join('');
}
