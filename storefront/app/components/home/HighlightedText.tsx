import {splitHighlight} from '~/lib/shopify/home-highlight';

/**
 * A heading's text with its `[[highlighted phrase]]` drawn as the red mark (CR-31). The parts are plain text nodes, so
 * nothing from admin becomes markup. There are at most three parts (before, marked, after), keyed by that role.
 */
export function HighlightedText({text}: {text: string}) {
  const parts = splitHighlight(text);
  const markedAt = parts.findIndex((part) => part.marked);
  return (
    <>
      {parts.map((part) =>
        part.marked ? (
          <span key="mark" className="type-mark">
            {part.text}
          </span>
        ) : (
          <span key={parts.indexOf(part) < markedAt ? 'before' : 'after'}>
            {part.text}
          </span>
        ),
      )}
    </>
  );
}
