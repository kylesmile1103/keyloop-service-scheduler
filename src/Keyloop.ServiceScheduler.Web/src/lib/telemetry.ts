import { context, propagation, SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api"
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base"

/** Configuration for browser OpenTelemetry OTLP trace export. */
export interface TelemetryConfig {
  /** OTLP/HTTP base URL. Empty disables tracing. */
  endpoint: string
  /** Comma-separated `key=value` headers sent with each export. */
  headers: string
  /** Comma-separated `key=value` resource attributes. */
  resourceAttributes: string
  /** Service resource name; browser spans report as `<name>-browser`. */
  serviceName: string
}

export interface TelemetryHandle {
  readonly enabled: boolean
  /** Stops exporting, removes fetch instrumentation, and unregisters the global tracer. */
  shutdown(): Promise<void>
}

/** Active span and context-preserving `fetch` wrapper passed to a traced callback. */
export interface TracedCall {
  span: Span
  /** Context-bound `fetch` to pass to the API client so requests after `await` remain attached to `span`. */
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
 * Runs `call` inside a span named `name` (e.g. `ui.book_appointment`, `ui.booking_triage`). Use the `fetch` it provides for
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
