// Local image files and Shopify staged uploads (REQ-CAT-003).
// Flow (shopify.dev stagedUploadsCreate, read 2026-10-12): ask Shopify for upload targets, POST the file
// to the returned url with the returned parameters, then use resourceUrl as the file's originalSource.
// UNVERIFIED(V-20): the multipart layout (parameters first, file last under the field name "file") comes
// from community answers, not from the shopify.dev page, and the staged hosts below are what those
// answers show. Both are checked on the first development-store run; the allow-list is deliberately narrow.

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { IMAGE_EXTENSIONS, MAX_IMAGE_BYTES } from './schema.mjs';

/** Hosts we are willing to send file bytes to. Anything else in an API answer is refused. */
export const STAGED_UPLOAD_HOST_SUFFIXES = Object.freeze(['storage.googleapis.com', 's3.amazonaws.com']);

const MIME_TYPES = Object.freeze({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' });

/**
 * @param {string} fileName
 * @returns {string | null}
 */
export function mimeTypeFor(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return IMAGE_EXTENSIONS.includes(extension) ? MIME_TYPES[/** @type {keyof typeof MIME_TYPES} */ (extension)] : null;
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedUploadUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
    return STAGED_UPLOAD_HOST_SUFFIXES.some((suffix) => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

/**
 * Checks the files a plan needs exist and are sane, without reading their bytes.
 * @param {string} directory
 * @param {readonly string[]} names
 * @returns {Promise<{ files: Map<string, { path: string, bytes: number }>, problems: string[] }>}
 */
export async function inspectImageFiles(directory, names) {
  /** @type {Map<string, { path: string, bytes: number }>} */
  const files = new Map();
  /** @type {string[]} */
  const problems = [];
  const root = path.resolve(directory);
  for (const name of new Set(names)) {
    const full = path.resolve(root, name);
    if (path.basename(name) !== name || path.dirname(full) !== root) {
      problems.push(`${name}: not a plain file name`);
      continue;
    }
    try {
      const info = await stat(full);
      if (!info.isFile()) problems.push(`${name}: not a file`);
      else if (info.size === 0) problems.push(`${name}: file is empty`);
      else if (info.size > MAX_IMAGE_BYTES) problems.push(`${name}: ${(info.size / (1024 * 1024)).toFixed(1)} MB is over the ${MAX_IMAGE_BYTES / (1024 * 1024)} MB limit`);
      else files.set(name, { path: full, bytes: info.size });
    } catch {
      problems.push(`${name}: file not found in ${directory}`);
    }
  }
  return { files, problems };
}

/**
 * POSTs one file to a staged target.
 * @param {{ url: string, parameters: { name: string, value: string }[] }} target
 * @param {{ name: string, path: string }} file
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
export async function uploadToStagedTarget(target, file, { fetch: doFetch = globalThis.fetch, timeoutMs = 120_000 } = {}) {
  if (!isAllowedUploadUrl(target.url)) {
    return { ok: false, message: `${file.name}: refusing to upload to a host that is not on the allow-list` };
  }
  const mimeType = mimeTypeFor(file.name);
  if (!mimeType) return { ok: false, message: `${file.name}: unsupported image type` };
  const bytes = await readFile(file.path);
  const form = new FormData();
  for (const parameter of target.parameters) form.append(parameter.name, parameter.value);
  form.append('file', new Blob([bytes], { type: mimeType }), file.name);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(target.url, { method: 'POST', body: form, redirect: 'error', signal: controller.signal });
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, message: `${file.name}: upload was rejected with HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    // The staged parameters carry a signed policy; never echo the error text, only that it failed.
    return { ok: false, message: `${file.name}: upload failed (${controller.signal.aborted ? 'timeout' : error instanceof Error ? error.name : 'error'})` };
  } finally {
    clearTimeout(timer);
  }
}
