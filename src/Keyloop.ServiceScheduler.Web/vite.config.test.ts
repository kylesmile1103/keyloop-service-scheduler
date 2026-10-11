import { describe, expect, it } from "vitest"

import { apiProxyTarget, devServerPort, otelDefines } from "./vite.config"

const aspireOtel = {
  OTEL_EXPORTER_OTLP_ENDPOINT: "https://localhost:21268",
  OTEL_EXPORTER_OTLP_HEADERS: "x-otlp-api-key=0123456789abcdef",
  OTEL_RESOURCE_ATTRIBUTES: "service.instance.id=web-abc",
  OTEL_SERVICE_NAME: "web",
}

describe("apiProxyTarget", () => {
  it("prefers the API_HTTP endpoint Aspire injects for the referenced api", () => {
    expect(
      apiProxyTarget({ API_HTTP: "http://localhost:6001", services__api__http__0: "http://localhost:6002" })
    ).toBe("http://localhost:6001")
  })

  it("falls back to the services__api__http__0 discovery variable", () => {
    expect(apiProxyTarget({ services__api__http__0: "http://localhost:6002" })).toBe("http://localhost:6002")
  })

  it("falls back to the API's http launch profile when nothing is injected", () => {
    expect(apiProxyTarget({})).toBe("http://localhost:5180")
  })
})

describe("devServerPort", () => {
  it("uses Aspire's PORT strictly so a busy port fails instead of moving", () => {
    expect(devServerPort({ PORT: "41234" })).toEqual({ port: 41234, strictPort: true })
  })

  it("uses the Vite default port loosely when PORT is unset", () => {
    expect(devServerPort({})).toEqual({ port: 5173, strictPort: false })
  })
})

describe("otelDefines", () => {
  it("exposes the Aspire OTLP settings to the browser on the development dev server", () => {
    expect(otelDefines("serve", "development", aspireOtel)).toEqual({
      "import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT": JSON.stringify("https://localhost:21268"),
      "import.meta.env.VITE_OTEL_EXPORTER_OTLP_HEADERS": JSON.stringify("x-otlp-api-key=0123456789abcdef"),
      "import.meta.env.VITE_OTEL_RESOURCE_ATTRIBUTES": JSON.stringify("service.instance.id=web-abc"),
      "import.meta.env.VITE_OTEL_SERVICE_NAME": JSON.stringify("web"),
    })
  })

  it("never compiles the OTLP headers (the dashboard API key) into a production build", () => {
    const defines = otelDefines("build", "production", {
      ...aspireOtel,
      VITE_OTEL_EXPORTER_OTLP_HEADERS: "x-otlp-api-key=leaked",
    })

    expect(defines["import.meta.env.VITE_OTEL_EXPORTER_OTLP_HEADERS"]).toBe('""')
    expect(Object.values(defines).join()).not.toContain("0123456789abcdef")
    expect(Object.values(defines).join()).not.toContain("leaked")
  })

  it("turns production telemetry off unless a collector endpoint is named explicitly at build time", () => {
    expect(otelDefines("build", "production", aspireOtel)["import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT"]).toBe('""')
    expect(
      otelDefines("build", "production", { VITE_OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example" })[
        "import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT"
      ]
    ).toBe(JSON.stringify("https://collector.example"))
  })

  it("keeps the key out of a development-mode build as well", () => {
    expect(otelDefines("build", "development", aspireOtel)["import.meta.env.VITE_OTEL_EXPORTER_OTLP_HEADERS"]).toBe('""')
  })

  it("disables telemetry in test runs", () => {
    expect(Object.values(otelDefines("serve", "test", aspireOtel))).toEqual(['""', '""', '""', '""'])
  })
})
