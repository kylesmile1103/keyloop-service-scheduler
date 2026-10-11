import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import { registerInstrumentations } from "@opentelemetry/instrumentation"
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load"
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch"
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources"
import { BatchSpanProcessor, type SpanProcessor } from "@opentelemetry/sdk-trace-base"
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web"
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions"

/**
 * The OpenTelemetry web SDK wiring. Loaded on demand by `initTelemetry` (lib/telemetry.ts) only when an OTLP endpoint is
 * configured, so a build with tracing off never downloads it.
 */
export interface BrowserTracingOptions {
  /** OTLP/HTTP base URL without a trailing slash. */
  endpoint: string
  headers: Record<string, string>
  resourceAttributes: Record<string, string>
  serviceName: string
  /** Replaces the batching OTLP export (tests record spans in memory). */
  spanProcessor?: SpanProcessor
}

export interface BrowserTracing {
  /** Removes the instrumentations and flushes and stops the provider. */
  stop(): Promise<void>
}

/** Registers a global WebTracerProvider plus fetch and document-load instrumentation. Throws if the SDK cannot start. */
export function startBrowserTracing(options: BrowserTracingOptions): BrowserTracing {
  const provider = new WebTracerProvider({
    resource: defaultResource().merge(
      resourceFromAttributes({ ...options.resourceAttributes, [ATTR_SERVICE_NAME]: options.serviceName })
    ),
    spanProcessors: [
      options.spanProcessor ??
        new BatchSpanProcessor(
          new OTLPTraceExporter({ url: `${options.endpoint}/v1/traces`, headers: options.headers }),
          { scheduledDelayMillis: 1000 }
        ),
    ],
  })
  provider.register()

  let unregister: (() => void) | undefined
  try {
    unregister = registerInstrumentations({
      tracerProvider: provider,
      instrumentations: [
        new FetchInstrumentation({
          // Same-origin requests (the proxied /api calls) carry traceparent; other origins never do.
          propagateTraceHeaderCorsUrls: [],
          // The exporter's own requests are not traced (that would feed back into itself).
          ignoreUrls: [/\/v1\/traces(?:\?|$)/],
          // The board polls every few seconds; do not let resource timings pile up.
          clearTimingResources: true,
        }),
        new DocumentLoadInstrumentation(),
      ],
    })
  } catch (error) {
    void provider.shutdown()
    throw error
  }

  const stopInstrumentations = unregister
  return {
    async stop() {
      stopInstrumentations()
      await provider.shutdown()
    },
  }
}
