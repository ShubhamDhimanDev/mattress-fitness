// SERVER ONLY. Reads a small form post with a hard size cap (T-01, T-13). The delivery and checkout-step forms
// carry a handful of short fields, so anything larger is refused before it is buffered: a declared length over
// the cap is refused at once, and a body that streams past the cap (no or false Content-Length) is cut off.

export const SMALL_FORM_MAX_BYTES = 4096;

export type SmallForm =
  | {readonly status: 'ok'; readonly form: FormData}
  | {readonly status: 'too-large' | 'unreadable'};

const FORM_TYPE =
  /^(application\/x-www-form-urlencoded|multipart\/form-data)\b/i;

export async function readSmallForm(
  request: Request,
  maxBytes: number = SMALL_FORM_MAX_BYTES,
): Promise<SmallForm> {
  const type = request.headers.get('Content-Type') ?? '';
  if (!FORM_TYPE.test(type) || request.body === null) {
    return {status: 'unreadable'};
  }
  const declared = request.headers.get('Content-Length');
  if (declared !== null && Number(declared) > maxBytes) {
    return {status: 'too-large'};
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return {status: 'too-large'};
      }
      chunks.push(value);
    }
  } catch {
    return {status: 'unreadable'};
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    // Re-parsed by the platform's own parser, so boundaries and encodings behave exactly as for request.formData().
    const form = await new Response(body, {
      headers: {'Content-Type': type},
    }).formData();
    return {status: 'ok', form};
  } catch {
    return {status: 'unreadable'};
  }
}
