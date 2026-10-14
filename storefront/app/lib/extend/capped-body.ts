// SERVER ONLY. Reads a Request or Response body without ever holding more than a cap (T-13, security review L-1).
// A declared Content-Length over the cap is refused before a byte is read; a body that lies about its length or has
// none (chunked) is cut off as soon as it passes the cap.

export type BodyRead =
  | {status: 'ok'; bytes: Uint8Array<ArrayBuffer>}
  | {status: 'too_large'}
  | {status: 'unreadable'};

type BodySource = {
  readonly headers: {get: (name: string) => string | null};
  readonly body: ReadableStream<Uint8Array> | null;
};

export async function readCappedBody(
  source: BodySource,
  maxBytes: number,
): Promise<BodyRead> {
  const declared = source.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d{1,12}$/.test(declared)) return {status: 'unreadable'};
    if (Number(declared) > maxBytes) return {status: 'too_large'};
  }
  if (source.body === null) return {status: 'ok', bytes: new Uint8Array(0)};
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return {status: 'too_large'};
      }
      chunks.push(value);
    }
  } catch {
    return {status: 'unreadable'};
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {status: 'ok', bytes};
}
