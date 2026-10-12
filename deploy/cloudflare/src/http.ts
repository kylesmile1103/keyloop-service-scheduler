export class BodyLimitError extends Error {}

// Bound the actual stream, including chunked bodies and misleading Content-Length.
export async function readLimitedBody(request: Request | Response, maxBytes: number): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    await request.body?.cancel();
    throw new BodyLimitError("Body exceeds the relay limit");
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new BodyLimitError("Body exceeds the relay limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function mediaType(request: Request): string {
  return (request.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
}

export function jsonError(code: string, status: number, retryable = status >= 500): Response {
  return Response.json({ code, retryable }, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
