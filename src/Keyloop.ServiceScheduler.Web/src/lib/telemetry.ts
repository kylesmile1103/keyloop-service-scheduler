import { context, propagation, SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api"
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base"

/**
 * Browser tracing (ARCHITECTURE §12.2, Addendum C §C5). The dispatch board sends its own spans to the Aspire dashboard
 * over OTLP/HTTP, and `traceparent` rides on same-origin `/api` calls, so one trace runs from a click through the API to
 * PostgreSQL.
 *
 * Only the small `@opentelemetry/api` package is bundled with the app; the SDK (lib/telemetry-sdk.ts) is loaded on demand
 * when an endpoint is configured.
 *
 * Security: `headers` carries the dashboard's OTLP API key. vite.config.ts compiles it into the bundle only for the
 * development dev server; every other build ships it empty and, unless a secret-free collector endpoint is named at
 * build time, ships with tracing off.
 */
export interface TelemetryConfig {
  /** OTLP/HTTP base URL, e.g. https://localhost:21268. Empty turns tracing off. */
  endpoint: string
  /** `key=value` pairs sent with every export (OTEL_EXPORTER_OTLP_HEADERS). */
  headers: string
  /** `key=value` resource attributes (OTEL_RESOURCE_ATTRIBUTES). */
  resourceAttributes: string
  /** The Aspire resource name (OTEL_SERVICE_NAME); browser spans report as `<name>-browser`. */
  serviceName: string
}

export interface TelemetryHandle {
  readonly enabled: boolean
  /** Stops exporting, removes the fetch instrumentation and unregisters the global tracer. */
  shutdown(): Promise<void>
}

/** What a traced call receives: its span, and a `fetch` that keeps requests inside that span. */
export interface TracedCall {
  span: Span
  /**
   * Pass this to the generated client (`{ fetch }` request option). The browser has no async context propagation, so a
   * request the client makes after an `await` would otherwise lose its parent span and start a separate trace.
   */
  fetch: typeof fetch
}

const TRACER_NAME = "Keyloop.ServiceScheduler.Web"

const disabled: TelemetryHandle = { enabled: false, shutdown: async () => {} }

let active: Promise<TelemetryHandle> | undefined

export function telemetryConfigFromEnv(): TelemetryConfig {
  return {
    endpoint: import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT ?? "",
    headers: import.meta.env.VITE_OTEL_EXPORTER_OTLP_HEADERS ?? "",
    resourceAttributes: import.meta.env.VITE_OTEL_RESOURCE_ATTRIBUTES ?? "",
    serviceName: import.meta.env.VITE_OTEL_SERVICE_NAME ?? "",
  }
}

/** Parses the `key=value,key2=value2` lists used by OTEL_* variables; values may be percent-encoded. */
export function parseKeyValueList(list: string | undefined): Record<string, string> {
  const pairs: Record<string, string> = {}
  for (const entry of (list ?? "").split(",")) {
    const separator = entry.indexOf("=")
    if (separator <= 0) continue
    const key = entry.slice(0, separator).trim()
    const raw = entry.slice(separator + 1).trim()
    if (!key) continue
    try {
      pairs[key] = decodeURIComponent(raw)
    } catch {
      pairs[key] = raw
    }
  }
  return pairs
}

/**
 * Starts browser tracing once (concurrent and repeated calls share the first start). Resolves to a disabled handle when no
 * endpoint is configured, without loading the SDK. Never rejects: if the SDK cannot start, the failure is reported on the
 * console and the board keeps working untraced.
 */
export function initTelemetry(
  config: TelemetryConfig = telemetryConfigFromEnv(),
  overrides: { spanProcessor?: SpanProcessor } = {}
): Promise<TelemetryHandle> {
  if (active) return active
  const endpoint = config.endpoint.trim().replace(/\/+$/, "")
  if (!endpoint) return Promise.resolve(disabled)

  active = start(endpoint, config, overrides.spanProcessor)
  return active
}

async function start(
  endpoint: string,
  config: TelemetryConfig,
  spanProcessor: SpanProcessor | undefined
): Promise<TelemetryHandle> {
  try {
    const { startBrowserTracing } = await import("@/lib/telemetry-sdk")
    const tracing = startBrowserTracing({
      endpoint,
      headers: parseKeyValueList(config.headers),
      resourceAttributes: parseKeyValueList(config.resourceAttributes),
      serviceName: `${config.serviceName.trim() || "web"}-browser`,
      spanProcessor,
    })
    return {
      enabled: true,
      async shutdown() {
        await tracing.stop()
        resetGlobals()
        active = undefined
      },
    }
  } catch (error) {
    resetGlobals()
    active = undefined
    console.error("Browser tracing is off: the OpenTelemetry SDK failed to start.", error)
    return disabled
  }
}

/**
 * Runs `call` inside a span named `name` (e.g. `ui.book_appointment`, `ui.stress_test`). Use the `fetch` it provides for
 * the requests that belong to the span. The span records a failure and the error is rethrown unchanged. Without
 * telemetry the span is a no-op and `fetch` is the plain browser fetch.
 */
export async function withSpan<T>(
  name: string,
  call: (traced: TracedCall) => Promise<T>,
  attributes?: Attributes
): Promise<T> {
  const span = trace.getTracer(TRACER_NAME).startSpan(name, { attributes })
  const spanContext = trace.setSpan(context.active(), span)
  const tracedFetch: typeof fetch = (...args) => context.with(spanContext, () => globalThis.fetch(...args))

  try {
    return await context.with(spanContext, () => call({ span, fetch: tracedFetch }))
  } catch (error) {
    span.recordException(error instanceof Error ? error : String(error))
    span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) })
    throw error
  } finally {
    span.end()
  }
}

function resetGlobals() {
  trace.disable()
  context.disable()
  propagation.disable()
}
