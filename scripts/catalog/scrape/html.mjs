// Small readers for data embedded in a downloaded page: JSON-LD blocks, an assigned JSON object (window.X = {...}), meta tags.
import { decodeEntities } from './model.mjs';

/** @param {string} html @returns {unknown[]} every JSON-LD node, flattened (arrays and @graph unwrapped) */
export function jsonLdNodes(html) {
  /** @type {unknown[]} */
  const nodes = [];
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed];
      nodes.push(...list);
    } catch {
      // A malformed block is skipped; the page's other data is still used.
    }
  }
  return nodes;
}

/**
 * Reads the JSON object assigned after `marker` (for example `window.__PRELOADED_PROPS__ = `), matching braces outside strings.
 * @param {string} html @param {string} marker
 * @returns {any | null}
 */
export function assignedJson(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const from = html.indexOf('{', at + marker.length);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < html.length; i += 1) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(html.slice(from, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** @param {string} html @param {string} key meta name or property */
export function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html);
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${escaped}["']`, 'i').exec(html);
  const value = a?.[1] ?? b?.[1];
  return value === undefined ? '' : decodeEntities(value);
}

/** @param {string} html */
export function pageTitle(html) {
  return decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim();
}

/** The visible text of a page, scripts and styles removed. @param {string} html */
export function visibleText(html) {
  return decodeEntities(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
