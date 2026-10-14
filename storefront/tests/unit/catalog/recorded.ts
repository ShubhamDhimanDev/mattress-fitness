// Recorded JSON is typed by what it contains (currency codes are plain strings), while the generated
// query types use Shopify's enums. This is the single narrowing helper for that gap: the data was
// recorded with the app's own query documents, and the mapper tests exercise the result.

export function recorded<T>(json: unknown): T {
  return structuredClone(json) as T;
}
