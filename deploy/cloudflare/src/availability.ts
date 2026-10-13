const RETRY_DELAY_MS = 150;
const RETRY_AFTER_SECONDS = 3;

// Only failures of the supplied transport become problems. An HTTP response, including an API 500 or 503, is final.
export async function fetchWithAvailability(request: Request, send: () => Promise<Response>): Promise<Response> {
  const retryable = request.method === "GET" || request.method === "HEAD";
  try {
    return await send();
  } catch {
    if (retryable && !request.signal.aborted) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      if (!request.signal.aborted) {
        try {
          return await send();
        } catch {
          // Both attempts failed to obtain an HTTP response. Never retain or log the exception's text.
        }
      }
    }
  }
  console.error(JSON.stringify({ event: "ApiUnavailable" }));
  const suppliedId = request.headers.get("x-request-id");
  const requestId = suppliedId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(suppliedId)
    ? suppliedId : crypto.randomUUID();
  return new Response(request.method === "HEAD" ? null : JSON.stringify({
    type: "https://api.keyloop.example/problems/service-unavailable",
    title: "Service unavailable",
    status: 503,
    detail: "The scheduler is temporarily unavailable. Please try again in a moment.",
    instance: new URL(request.url).pathname,
    traceId: requestId,
  }), {
    status: 503,
    statusText: "Service Unavailable",
    headers: {
      "content-type": "application/problem+json",
      "retry-after": String(RETRY_AFTER_SECONDS),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
}
