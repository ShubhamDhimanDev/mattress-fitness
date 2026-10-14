// Plain-text view of Shopify content. The storefront does not render admin HTML: descriptions are plain
// paragraphs and rich-text metafields (the Storefront API returns them as JSON) are flattened to paragraphs
// of text. React escapes the text on render, so nothing the admin types can become markup (T-07).

import {cleanText} from '~/lib/catalog/text';

const MAX_PARAGRAPHS = 20;
const MAX_PARAGRAPH_LENGTH = 1500;
const MAX_NODE_DEPTH = 8;

/** Paragraphs from plain text: blank lines separate paragraphs, single newlines are joined with a space. */
export function textToParagraphs(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((part) => cleanText(part).slice(0, MAX_PARAGRAPH_LENGTH))
    .filter((part) => part !== '')
    .slice(0, MAX_PARAGRAPHS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nodeText(node: unknown, depth: number): string {
  if (!isRecord(node) || depth > MAX_NODE_DEPTH) return '';
  if (typeof node.value === 'string') return node.value;
  const children = node.children;
  if (!Array.isArray(children)) return '';
  return children.map((child) => nodeText(child, depth + 1)).join('');
}

/**
 * Shopify rich text (`{"type":"root","children":[...]}`) flattened to one paragraph per block, with list
 * items and headings as their own paragraphs. Text that is not JSON is treated as plain text.
 */
export function richTextToParagraphs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = raw.length > 50_000 ? null : JSON.parse(raw);
  } catch {
    return textToParagraphs(raw);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.children)) {
    return typeof parsed === 'string' ? textToParagraphs(parsed) : [];
  }

  const paragraphs: string[] = [];
  for (const block of parsed.children) {
    if (!isRecord(block)) continue;
    const parts =
      block.type === 'list' && Array.isArray(block.children)
        ? block.children.map((item) => nodeText(item, 1))
        : [nodeText(block, 0)];
    for (const part of parts) {
      const text = cleanText(part).slice(0, MAX_PARAGRAPH_LENGTH);
      if (text !== '') paragraphs.push(text);
    }
  }
  return paragraphs.slice(0, MAX_PARAGRAPHS);
}
